import { Optional, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BillStatus, VoucherType } from '@ai-accounting/shared';
import { DebitNote, DebitNoteDocument } from './schemas/debit-note.schema';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { addSplits, noteAmounts, rupees } from '../gl/note-amounts';
import { tdsOn } from '../gl/tds';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { formatVoucherNumber } from '../journals/journals.service';
import { withOrg } from '../database/tenant.plugin';

export interface CreateDebitNoteInput {
  noteDate: string;
  reason: string;
  /** How much taxable value to take off; tax follows in the bill's proportions. */
  taxableValuePaise: number;
}

export interface DebitNoteListItem {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  billId: string;
  billNumber: string | null;
  vendorName: string;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  totalPaise: number;
  journalId: string;
}

const TAX_KEYS = [
  ['cgst', SystemAccountKey.GST_INPUT_CGST],
  ['sgst', SystemAccountKey.GST_INPUT_SGST],
  ['igst', SystemAccountKey.GST_INPUT_IGST],
  ['cess', SystemAccountKey.GST_INPUT_CESS],
] as const;

@Injectable()
export class DebitNotesService {
  private readonly logger = new Logger(DebitNotesService.name);

  constructor(
    @InjectModel(DebitNote.name) private noteModel: Model<DebitNoteDocument>,
    @InjectModel(PurchaseBill.name) private docModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private partyModel: Model<VendorDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    private accountsService: AccountsService,
    private postingService: PostingService,
    private auditService: AuditService,
    // Optional so specs that build this by hand need not: without it, a note
    // larger than what is owed is refused, as before.
    @Optional() private payments?: PartyPaymentsService,
  ) {}

  /**
   * Raise a debit note against a posted bill and post it, in one transaction:
   * the DEBIT_NOTE voucher, the note, the bill's reduced balance and the
   * audit rows commit together.
   *
   * Journal: Dr Accounts Payable / Cr expense + Cr input tax. The expense line goes back to the ledger
   * the bill itself posted to, so a bill the reviewer booked to another
   * account is corrected there, not in the default.
   */
  async create(billId: string, orgId: string, actorId: string, input: CreateDebitNoteInput): Promise<DebitNoteDocument> {
    return this.postingService.inTransaction(async (session) => {
      const doc = await withOrg(orgId, () => this.docModel.findById(billId).session(session).exec());
      if (!doc) throw new NotFoundException('PurchaseBill not found');
      const docLabel = `Bill ${doc.billNumber ?? doc._id}`;
      if (doc.status !== BillStatus.POSTED && doc.status !== BillStatus.PAID) {
        throw new BadRequestException(`Only a posted bill can take a debit note (this one is ${doc.status})`);
      }
      if (input.noteDate < doc.billDate) {
        throw new BadRequestException('A debit note cannot be dated before the bill it corrects');
      }

      const earlier = await withOrg(orgId, () =>
        this.noteModel.find({ billId: doc._id, status: 'posted' }).session(session).lean().exec(),
      );
      const amounts = noteAmounts(doc.amountsPaise, addSplits(earlier.map((n) => n.amountsPaise)), input.taxableValuePaise);
      const owed = outstandingPaise(doc);
      // What the note takes off the vendor's balance: its total — its taxable
      // value only under reverse charge, where the tax was never theirs — less
      // the share of the TDS deducted on that taxable value, which comes back
      // off TDS Payable instead.
      const payablePart = doc.isReverseCharge ? amounts.taxableValue : amounts.total;
      const noteTds = doc.tds ? Math.min(tdsOn(amounts.taxableValue, doc.tds.rateBps), doc.tds.amountPaise) : 0;
      const reduction = payablePart - noteTds;
      if (noteTds > 0 && doc.tds?.depositId) {
        throw new BadRequestException(
          `The TDS on ${docLabel} has already been deposited — a debit note now would need the TDS corrected in the return. Raise it after the next deposit is adjusted, or take it up with your CA.`,
        );
      }
      // What the note takes off the bill; anything beyond what is still owed was
      // already paid, and the vendor owes it back: their credit (an advance).
      const offBill = Math.min(reduction, owed);
      const excess = reduction - offBill;
      if (excess > 0 && (!this.payments || noteTds > 0)) {
        throw new BadRequestException(
          `A debit note of ${rupees(reduction)} is more than the ${rupees(owed)} still owed on ${docLabel}` +
            (noteTds > 0 ? ': TDS was withheld on this bill, so raise the note before the bill is paid, or take it up with your CA' : ''),
        );
      }

      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
        SystemAccountKey.PURCHASE_EXPENSE,
        SystemAccountKey.ACCOUNTS_PAYABLE,
        SystemAccountKey.ROUND_OFF,
        SystemAccountKey.TDS_PAYABLE,
        SystemAccountKey.RCM_GST_PAYABLE,
        SystemAccountKey.VENDOR_ADVANCES,
        ...TAX_KEYS.map(([, key]) => key),
      ]);
      const control = accounts.get(SystemAccountKey.ACCOUNTS_PAYABLE)!;
      const main = await this.originalLedger(
        doc.journalId,
        new Set([control, accounts.get(SystemAccountKey.ROUND_OFF)!, ...TAX_KEYS.map(([, key]) => accounts.get(key)!)].map((a) => String(a._id))),
        accounts.get(SystemAccountKey.PURCHASE_EXPENSE)!,
        orgId,
        session,
      );

      const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number }> = [
        { accountId: main._id, description: main.name, debitPaise: 0, creditPaise: amounts.taxableValue },
      ];
      for (const [head, key] of TAX_KEYS) {
        if (amounts[head] > 0) {
          const tax = accounts.get(key)!;
          lines.push({ accountId: tax._id.toString(), description: tax.name, debitPaise: 0, creditPaise: amounts[head] });
        }
      }
      if (offBill > 0) lines.push({ accountId: control._id.toString(), description: control.name, debitPaise: offBill, creditPaise: 0 });
      if (excess > 0) {
        const advances = accounts.get(SystemAccountKey.VENDOR_ADVANCES)!;
        lines.push({ accountId: advances._id.toString(), description: advances.name, debitPaise: excess, creditPaise: 0 });
      }
      if (noteTds > 0) {
        const tdsAccount = accounts.get(SystemAccountKey.TDS_PAYABLE)!;
        lines.push({ accountId: tdsAccount._id.toString(), description: tdsAccount.name, debitPaise: noteTds, creditPaise: 0 });
      }
      const noteTax = amounts.total - amounts.taxableValue;
      if (doc.isReverseCharge && noteTax > 0) {
        // The reverse-charge liability on the returned part falls away with it.
        const rcm = accounts.get(SystemAccountKey.RCM_GST_PAYABLE)!;
        lines.push({ accountId: rcm._id.toString(), description: rcm.name, debitPaise: noteTax, creditPaise: 0 });
      }

      const financialYear = financialYearOf(input.noteDate);
      const journal = await this.postingService.post(
        {
          orgId,
          voucherType: VoucherType.DEBIT_NOTE,
          financialYear,
          date: input.noteDate,
          narration: `Debit note against ${docLabel} — ${input.reason}`,
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
            billId: doc._id,
            vendorId: doc.vendorId,
            noteNumber: formatVoucherNumber(VoucherType.DEBIT_NOTE, financialYear, journal.voucherNumber),
            noteDate: input.noteDate,
            financialYear,
            reason: input.reason,
            amountsPaise: amounts,
            tdsPaise: noteTds,
            journalId: journal._id,
            createdBy: actorId,
          },
        ],
        { session },
      );

      // Nothing left owed closes the bill. A paid bill is left as it is: the
      // whole note is the vendor's credit. (With TDS, a note never exceeds
      // what is owed; refused above.)
      const closes = offBill === owed;
      const takenOff = excess > 0 ? offBill : payablePart;
      const updated =
        takenOff > 0 || noteTds > 0
          ? await withOrg(orgId, () =>
              this.docModel
                .findOneAndUpdate(
                  { _id: doc._id, status: BillStatus.POSTED, adjustedPaise: doc.adjustedPaise ?? 0 },
                  {
                    $inc: { adjustedPaise: takenOff, ...(noteTds > 0 ? { 'tds.amountPaise': -noteTds } : {}) },
                    $push: {
                      adjustments: {
                        noteId,
                        journalId: journal._id,
                        amountPaise: takenOff,
                        tdsPaise: noteTds,
                        noteDate: input.noteDate,
                      },
                    },
                    $set: closes ? { status: BillStatus.PAID } : {},
                  },
                  { new: true, session },
                )
                .exec(),
            )
          : doc;
      if (!updated) throw new BadRequestException('This bill changed while the note was being raised — try again');
      if (excess > 0) {
        const vendor = await this.partyModel.findOne({ _id: doc.vendorId, orgId }, { name: 1 }).session(session).lean().exec();
        await this.payments!.creditFromNote(
          orgId,
          actorId,
          { kind: 'payment', partyId: doc.vendorId as unknown as Types.ObjectId, partyName: vendor?.name ?? 'Vendor', date: input.noteDate, journalId: journal._id, noteNumber: note.noteNumber, excessPaise: excess },
          session,
        );
      }

      await this.auditService.record(
        {
          orgId,
          entityType: 'DebitNote',
          entityId: String(noteId),
          action: 'CREATE',
          performedBy: actorId,
          after: { noteNumber: note.noteNumber, billId: String(doc._id), totalPaise: amounts.total, reason: input.reason },
        },
        session,
      );
      await this.auditService.record(
        {
          orgId,
          entityType: 'PurchaseBill',
          entityId: String(doc._id),
          action: 'DEBIT',
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

  async list(orgId: string, billId?: string): Promise<DebitNoteListItem[]> {
    const filter = billId ? { billId: new Types.ObjectId(billId) } : {};
    const notes = await withOrg(orgId, () => this.noteModel.find(filter).sort({ noteDate: -1, noteNumber: -1 }).limit(200).lean().exec());
    const docIds = [...new Set(notes.map((n) => String(n.billId)))];
    const partyIds = [...new Set(notes.map((n) => String(n.vendorId)))];
    const [docs, parties] = await Promise.all([
      withOrg(orgId, () => this.docModel.find({ _id: { $in: docIds } }).select('billNumber').lean().exec()),
      withOrg(orgId, () => this.partyModel.find({ _id: { $in: partyIds } }).select('name').lean().exec()),
    ]);
    const docNumber = new Map(docs.map((d) => [String(d._id), d.billNumber ?? null]));
    const partyName = new Map(parties.map((p) => [String(p._id), p.name]));
    return notes.map((n) => ({
      _id: String(n._id),
      noteNumber: n.noteNumber,
      noteDate: n.noteDate,
      reason: n.reason,
      status: n.status,
      billId: String(n.billId),
      billNumber: docNumber.get(String(n.billId)) ?? null,
      vendorName: partyName.get(String(n.vendorId)) ?? 'Unknown',
      amountsPaise: n.amountsPaise,
      totalPaise: n.amountsPaise.total,
      journalId: String(n.journalId),
    }));
  }

  /**
   * The ledger the bill posted its expense to: the largest debit line
   * on its journal that is not tax, round-off or the payable.
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
      .filter((l) => l.debitPaise > 0 && !exclude.has(String(l.accountId)))
      .sort((a, b) => b.debitPaise - a.debitPaise)[0];
    return main
      ? { _id: String(main.accountId), name: main.description || fallback.name }
      : { _id: String(fallback._id), name: fallback.name };
  }
}
