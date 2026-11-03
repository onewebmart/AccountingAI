import { Optional, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { CreditNote, CreditNoteDocument } from './schemas/credit-note.schema';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { addSplits, noteAmounts, rupees } from '../gl/note-amounts';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { formatVoucherNumber } from '../journals/journals.service';
import { withOrg } from '../database/tenant.plugin';

export interface CreateCreditNoteInput {
  noteDate: string;
  reason: string;
  /** How much taxable value to take off; tax follows in the invoice's proportions. */
  taxableValuePaise: number;
}

export interface CreditNoteListItem {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  totalPaise: number;
  journalId: string;
}

const TAX_KEYS = [
  ['cgst', SystemAccountKey.GST_OUTPUT_CGST],
  ['sgst', SystemAccountKey.GST_OUTPUT_SGST],
  ['igst', SystemAccountKey.GST_OUTPUT_IGST],
  ['cess', SystemAccountKey.GST_OUTPUT_CESS],
] as const;

@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);

  constructor(
    @InjectModel(CreditNote.name) private noteModel: Model<CreditNoteDocument>,
    @InjectModel(SalesInvoice.name) private docModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private partyModel: Model<CustomerDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    private accountsService: AccountsService,
    private postingService: PostingService,
    private auditService: AuditService,
    // Optional so specs that build this by hand need not: without it, a note
    // larger than what is owed is refused, as before.
    @Optional() private payments?: PartyPaymentsService,
  ) {}

  /**
   * Raise a credit note against a posted invoice and post it, in one transaction:
   * the CREDIT_NOTE voucher, the note, the invoice's reduced balance and the
   * audit rows commit together.
   *
   * Journal: Dr sales + Dr output tax / Cr Accounts Receivable. The sales line goes back to the ledger
   * the invoice itself posted to, so a invoice the reviewer booked to another
   * account is corrected there, not in the default.
   */
  async create(invoiceId: string, orgId: string, actorId: string, input: CreateCreditNoteInput): Promise<CreditNoteDocument> {
    return this.postingService.inTransaction(async (session) => {
      const doc = await withOrg(orgId, () => this.docModel.findById(invoiceId).session(session).exec());
      if (!doc) throw new NotFoundException('SalesInvoice not found');
      const docLabel = `Invoice ${doc.invoiceNumber ?? doc._id}`;
      if (doc.status !== InvoiceStatus.POSTED && doc.status !== InvoiceStatus.PAID) {
        throw new BadRequestException(`Only a posted invoice can take a credit note (this one is ${doc.status})`);
      }
      if (input.noteDate < doc.invoiceDate) {
        throw new BadRequestException('A credit note cannot be dated before the invoice it corrects');
      }

      const earlier = await withOrg(orgId, () =>
        this.noteModel.find({ invoiceId: doc._id, status: 'posted' }).session(session).lean().exec(),
      );
      const amounts = noteAmounts(doc.amountsPaise, addSplits(earlier.map((n) => n.amountsPaise)), input.taxableValuePaise);
      const owed = outstandingPaise(doc);
      // What the note takes off the invoice; anything beyond what is still owed
      // was already paid, and becomes the customer's credit (an advance).
      const offInvoice = Math.min(amounts.total, owed);
      const excess = amounts.total - offInvoice;
      if (excess > 0 && !this.payments) {
        throw new BadRequestException(`A credit note of ${rupees(amounts.total)} is more than the ${rupees(owed)} still owed on ${docLabel}`);
      }

      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
        SystemAccountKey.SALES_REVENUE,
        SystemAccountKey.ACCOUNTS_RECEIVABLE,
        SystemAccountKey.CUSTOMER_ADVANCES,
        SystemAccountKey.ROUND_OFF,
        ...TAX_KEYS.map(([, key]) => key),
      ]);
      const control = accounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!;
      const main = await this.originalLedger(
        doc.journalId,
        new Set([control, accounts.get(SystemAccountKey.ROUND_OFF)!, ...TAX_KEYS.map(([, key]) => accounts.get(key)!)].map((a) => String(a._id))),
        accounts.get(SystemAccountKey.SALES_REVENUE)!,
        orgId,
        session,
      );

      const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number }> = [
        { accountId: main._id, description: main.name, debitPaise: amounts.taxableValue, creditPaise: 0 },
      ];
      for (const [head, key] of TAX_KEYS) {
        if (amounts[head] > 0) {
          const tax = accounts.get(key)!;
          lines.push({ accountId: tax._id.toString(), description: tax.name, debitPaise: amounts[head], creditPaise: 0 });
        }
      }
      if (offInvoice > 0) lines.push({ accountId: control._id.toString(), description: control.name, debitPaise: 0, creditPaise: offInvoice });
      if (excess > 0) {
        const advances = accounts.get(SystemAccountKey.CUSTOMER_ADVANCES)!;
        lines.push({ accountId: advances._id.toString(), description: advances.name, debitPaise: 0, creditPaise: excess });
      }

      const financialYear = financialYearOf(input.noteDate);
      const journal = await this.postingService.post(
        {
          orgId,
          voucherType: VoucherType.CREDIT_NOTE,
          financialYear,
          date: input.noteDate,
          narration: `Credit note against ${docLabel} — ${input.reason}`,
          postedBy: actorId,
          lines,
        },
        session,
      );

      const noteId = new Types.ObjectId();
      const [note] = await this.noteModel.create(
        [
          {
            _id: noteId,
            orgId,
            invoiceId: doc._id,
            customerId: doc.customerId,
            noteNumber: formatVoucherNumber(VoucherType.CREDIT_NOTE, financialYear, journal.voucherNumber),
            noteDate: input.noteDate,
            financialYear,
            reason: input.reason,
            amountsPaise: amounts,
            journalId: journal._id,
            createdBy: actorId,
          },
        ],
        { session },
      );

      // Nothing left owed closes the invoice. A paid invoice is left as it is:
      // the whole note is the customer's credit.
      const closes = offInvoice === owed;
      const updated =
        offInvoice > 0
          ? await withOrg(orgId, () =>
              this.docModel
                .findOneAndUpdate(
                  { _id: doc._id, status: InvoiceStatus.POSTED, adjustedPaise: doc.adjustedPaise ?? 0 },
                  {
                    $inc: { adjustedPaise: offInvoice },
                    $push: { adjustments: { noteId, journalId: journal._id, amountPaise: offInvoice, noteDate: input.noteDate } },
                    $set: closes ? { status: InvoiceStatus.PAID } : {},
                  },
                  { new: true, session },
                )
                .exec(),
            )
          : doc;
      if (!updated) throw new BadRequestException('This invoice changed while the note was being raised — try again');
      if (excess > 0) {
        const customer = await this.partyModel.findOne({ _id: doc.customerId, orgId }, { name: 1 }).session(session).lean().exec();
        await this.payments!.creditFromNote(
          orgId,
          actorId,
          { kind: 'receipt', partyId: doc.customerId as unknown as Types.ObjectId, partyName: customer?.name ?? 'Customer', date: input.noteDate, journalId: journal._id, noteNumber: note.noteNumber, excessPaise: excess },
          session,
        );
      }

      await this.auditService.record(
        {
          orgId,
          entityType: 'CreditNote',
          entityId: String(noteId),
          action: 'CREATE',
          performedBy: actorId,
          after: { noteNumber: note.noteNumber, invoiceId: String(doc._id), totalPaise: amounts.total, reason: input.reason },
        },
        session,
      );
      await this.auditService.record(
        {
          orgId,
          entityType: 'SalesInvoice',
          entityId: String(doc._id),
          action: 'CREDIT',
          performedBy: actorId,
          before: { status: doc.status, adjustedPaise: doc.adjustedPaise ?? 0 },
          after: { status: updated.status, adjustedPaise: updated.adjustedPaise, noteNumber: note.noteNumber },
        },
        session,
      );

      this.logger.log(`${note.noteNumber} raised against ${docLabel} for ${rupees(amounts.total)}`);
      return note;
    });
  }

  async list(orgId: string, invoiceId?: string): Promise<CreditNoteListItem[]> {
    const filter = invoiceId ? { invoiceId: new Types.ObjectId(invoiceId) } : {};
    const notes = await withOrg(orgId, () => this.noteModel.find(filter).sort({ noteDate: -1, noteNumber: -1 }).limit(200).lean().exec());
    const docIds = [...new Set(notes.map((n) => String(n.invoiceId)))];
    const partyIds = [...new Set(notes.map((n) => String(n.customerId)))];
    const [docs, parties] = await Promise.all([
      withOrg(orgId, () => this.docModel.find({ _id: { $in: docIds } }).select('invoiceNumber').lean().exec()),
      withOrg(orgId, () => this.partyModel.find({ _id: { $in: partyIds } }).select('name').lean().exec()),
    ]);
    const docNumber = new Map(docs.map((d) => [String(d._id), d.invoiceNumber ?? null]));
    const partyName = new Map(parties.map((p) => [String(p._id), p.name]));
    return notes.map((n) => ({
      _id: String(n._id),
      noteNumber: n.noteNumber,
      noteDate: n.noteDate,
      reason: n.reason,
      status: n.status,
      invoiceId: String(n.invoiceId),
      invoiceNumber: docNumber.get(String(n.invoiceId)) ?? null,
      customerName: partyName.get(String(n.customerId)) ?? 'Unknown',
      amountsPaise: n.amountsPaise,
      totalPaise: n.amountsPaise.total,
      journalId: String(n.journalId),
    }));
  }

  /**
   * The ledger the invoice posted its sales to: the largest credit line
   * on its journal that is not tax, round-off or the receivable.
   */
  private async originalLedger(
    journalId: Types.ObjectId | null,
    exclude: Set<string>,
    fallback: { _id: Types.ObjectId; name: string },
    orgId: string,
    session: ClientSession,
  ): Promise<{ _id: string; name: string }> {
    const journal = journalId
      ? await withOrg(orgId, () => this.journalModel.findById(journalId).session(session).lean().exec())
      : null;
    const main = (journal?.lines ?? [])
      .filter((l) => l.creditPaise > 0 && !exclude.has(String(l.accountId)))
      .sort((a, b) => b.creditPaise - a.creditPaise)[0];
    return main
      ? { _id: String(main.accountId), name: main.description || fallback.name }
      : { _id: String(fallback._id), name: fallback.name };
  }
}
