import { Optional, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AccountType, InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { CreditNote, CreditNoteDocument, NoteLine } from './schemas/credit-note.schema';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { addSplits, noteAmounts, rupees, TaxSplit } from '../gl/note-amounts';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { formatVoucherNumber } from '../journals/journals.service';
import { withOrg } from '../database/tenant.plugin';
import { allocate } from '../gst/gst-returns';
import { ItemsService } from '../items/items.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { DiscountInput, isInterState, lineAmount, lineProblem, lineTaxable, priceDoc, text } from '../orders/doc-lines';

export interface CreateCreditNoteInput {
  noteDate: string;
  reason: string;
  /** How much taxable value to take off; tax follows in the invoice's proportions. */
  taxableValuePaise: number;
}

/** A credit note line by line: what is credited, to which income account, at its own slab. */
export interface ItemisedCreditNoteInput {
  customerId: string;
  /** The invoice it corrects: GST asks the note to name it (rule 53(1A)), and GSTR-1 files it beside it. */
  invoiceId: string;
  noteDate: string;
  reason: string;
  lines: Array<{ description: string; itemId?: string | null; hsnSac?: string | null; uqc?: string | null; qty: number; ratePaise: number; taxRatePct: number; accountId?: string | null }>;
  discount?: DiscountInput | null;
  referenceNumber?: string | null;
  subject?: string | null;
  salespersonName?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
}

export interface CreditNoteListItem {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  kind: 'value' | 'itemised';
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  totalPaise: number;
  journalId: string;
  lines: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; discountPaise: number; taxRatePct: number; accountId: string; accountName: string | null }>;
  discount: { percent: number | null; amountPaise: number } | null;
  referenceNumber: string | null;
  subject: string | null;
  salespersonName: string | null;
  notes: string | null;
  termsAndConditions: string | null;
}

const TAX_KEYS = [
  ['cgst', SystemAccountKey.GST_OUTPUT_CGST],
  ['sgst', SystemAccountKey.GST_OUTPUT_SGST],
  ['igst', SystemAccountKey.GST_OUTPUT_IGST],
  ['cess', SystemAccountKey.GST_OUTPUT_CESS],
] as const;

type Debit = { accountId: string; description: string; debitPaise: number; creditPaise: number; projectId?: string | null };

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
    // Optional for the same reason: only the itemised note reads items, accounts and our state.
    @Optional() private items?: ItemsService,
    @Optional() @InjectModel(LedgerAccount.name) private accountModel?: Model<LedgerAccountDocument>,
    @Optional() @InjectModel(OrgSettings.name) private settingsModel?: Model<OrgSettingsDocument>,
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
      const doc = await this.postedInvoice(orgId, invoiceId, input.noteDate, session);
      const earlier = await withOrg(orgId, () =>
        this.noteModel.find({ invoiceId: doc._id, status: 'posted' }).session(session).lean().exec(),
      );
      const amounts = noteAmounts(doc.amountsPaise, addSplits(earlier.map((n) => n.amountsPaise)), input.taxableValuePaise);

      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
        SystemAccountKey.SALES_REVENUE,
        SystemAccountKey.ACCOUNTS_RECEIVABLE,
        SystemAccountKey.ROUND_OFF,
        ...TAX_KEYS.map(([, key]) => key),
      ]);
      const mains = await this.originalLedgers(
        doc.journalId,
        new Set([accounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!, accounts.get(SystemAccountKey.ROUND_OFF)!, ...TAX_KEYS.map(([, key]) => accounts.get(key)!)].map((a) => String(a._id))),
        accounts.get(SystemAccountKey.SALES_REVENUE)!,
        orgId,
        session,
      );
      const shares = allocate(amounts.taxableValue, mains.map((m) => m.weight));
      const debits: Debit[] = mains
        .map((m, i) => ({ accountId: m._id, description: m.name, debitPaise: shares[i], creditPaise: 0, projectId: m.projectId }))
        .filter((l, i) => l.debitPaise > 0 || i === 0);

      return this.raise(orgId, actorId, session, doc, { noteDate: input.noteDate, reason: input.reason, amounts, debits, record: { kind: 'value' } });
    });
  }

  /**
   * An itemised credit note: lines of what is credited (goods returned, a
   * price corrected), each back off an income account, Sales by default or
   * the item's own. It is against one of the customer's posted invoices and
   * taxed as that invoice was (IGST, or CGST and SGST), each line at its
   * slab after its share of any discount. It may not take back more value,
   * or more of any tax, than the invoice has left after earlier notes.
   *
   * Journal: Dr income per account, Dr output GST by head / Cr Accounts
   * Receivable for what the invoice still owes, Cr Advances from Customers
   * for the rest, which becomes the customer's credit. Numbered in the same
   * CRN series as every credit note.
   */
  async createItemised(orgId: string, actorId: string, input: ItemisedCreditNoteInput): Promise<CreditNoteDocument> {
    if (!this.items || !this.accountModel || !this.settingsModel) throw new BadRequestException('Itemised credit notes need the items module.');
    if (!input.lines?.length) throw new BadRequestException('Add at least one line.');
    input.lines.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(
      orgId,
      input.lines.map((l) => ({ description: l.description.trim(), itemId: l.itemId || null, hsnSac: l.hsnSac?.trim() || null, uqc: l.uqc || null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })),
      'sale',
    );

    return this.postingService.inTransaction(async (session) => {
      const doc = await this.postedInvoice(orgId, input.invoiceId, input.noteDate, session);
      if (String(doc.customerId) !== input.customerId) throw new BadRequestException('That invoice is another customer’s. Pick one of this customer’s invoices.');
      if (doc.foreign || doc.exportType) throw new BadRequestException('This is an export invoice: raise its credit note by value, from the invoice.');

      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [SystemAccountKey.SALES_REVENUE, ...TAX_KEYS.map(([, key]) => key)]);
      const sales = accounts.get(SystemAccountKey.SALES_REVENUE)!;
      // A line goes back off the account it names, else its item's income account, else Sales.
      const accountIds = resolved.map((l, i) => input.lines[i].accountId || (l.accountId ? String(l.accountId) : String(sales._id)));
      const income = await this.incomeAccounts(orgId, accountIds, session);

      // The note is taxed as its invoice was: IGST if that charged IGST, CGST and SGST if it charged those.
      const a = doc.amountsPaise;
      const interState = a.igst > 0 ? true : a.cgst + a.sgst > 0 ? false : await this.interStateNow(orgId, doc.customerId);
      const priced = priceDoc(resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })), interState, { discount: input.discount });
      const amounts: TaxSplit = priced.amounts;
      if (amounts.total <= 0) throw new BadRequestException('A credit note needs an amount.');

      // Never more back than the invoice has left, in value or in any tax.
      const earlier = await withOrg(orgId, () => this.noteModel.find({ invoiceId: doc._id, status: 'posted' }).session(session).lean().exec());
      const noted = addSplits(earlier.map((n) => n.amountsPaise));
      if (amounts.taxableValue > a.taxableValue - noted.taxableValue) {
        throw new BadRequestException(`Only ${rupees(a.taxableValue - noted.taxableValue)} of taxable value is left to credit on invoice ${doc.invoiceNumber ?? doc._id}.`);
      }
      for (const head of ['cgst', 'sgst', 'igst', 'cess'] as const) {
        if (amounts[head] > a[head] - noted[head]) {
          throw new BadRequestException(`This note takes back ${rupees(amounts[head])} of ${head.toUpperCase()}, more than the ${rupees(a[head] - noted[head])} left on invoice ${doc.invoiceNumber ?? doc._id}. Check each line's GST rate against the invoice.`);
        }
      }

      const byAccount = new Map<string, number>();
      priced.lines.forEach((l, i) => byAccount.set(accountIds[i], (byAccount.get(accountIds[i]) ?? 0) + lineTaxable(l)));
      const debits: Debit[] = [...byAccount.entries()]
        .filter(([, v]) => v > 0)
        .map(([id, v]) => ({ accountId: id, description: income.get(id)!, debitPaise: v, creditPaise: 0 }));

      const lines: NoteLine[] = priced.lines.map((l, i) => ({
        description: l.description,
        itemId: l.itemId,
        hsnSac: l.hsnSac ?? null,
        uqc: l.uqc ?? null,
        qty: l.qty,
        ratePaise: l.ratePaise,
        amountPaise: l.amountPaise,
        discountPaise: l.discountPaise,
        taxRatePct: l.taxRatePct,
        accountId: new Types.ObjectId(accountIds[i]),
      }));
      return this.raise(orgId, actorId, session, doc, {
        noteDate: input.noteDate,
        reason: input.reason.trim(),
        amounts,
        debits,
        record: {
          kind: 'itemised',
          lines,
          discount: priced.discount,
          referenceNumber: text(input.referenceNumber, 60),
          subject: text(input.subject, 250),
          salespersonName: text(input.salespersonName, 80),
          notes: text(input.notes, 2000),
          termsAndConditions: text(input.termsAndConditions, 3000),
        },
      });
    });
  }

  async list(orgId: string, invoiceId?: string): Promise<CreditNoteListItem[]> {
    if (invoiceId !== undefined && !Types.ObjectId.isValid(invoiceId)) return [];
    const filter = invoiceId ? { invoiceId: new Types.ObjectId(invoiceId) } : {};
    const notes = await withOrg(orgId, () => this.noteModel.find(filter).sort({ noteDate: -1, noteNumber: -1 }).limit(200).lean().exec());
    const docIds = [...new Set(notes.map((n) => String(n.invoiceId)))];
    const partyIds = [...new Set(notes.map((n) => String(n.customerId)))];
    const accountIds = [...new Set(notes.flatMap((n) => (n.lines ?? []).map((l) => String(l.accountId))))];
    const [docs, parties, accountNames] = await Promise.all([
      withOrg(orgId, () => this.docModel.find({ _id: { $in: docIds } }).select('invoiceNumber').lean().exec()),
      withOrg(orgId, () => this.partyModel.find({ _id: { $in: partyIds } }).select('name').lean().exec()),
      accountIds.length ? this.accountsService.namesOf(orgId, accountIds) : Promise.resolve(new Map<string, string>()),
    ]);
    const docNumber = new Map(docs.map((d) => [String(d._id), d.invoiceNumber ?? null]));
    const partyName = new Map(parties.map((p) => [String(p._id), p.name]));
    return notes.map((n) => ({
      _id: String(n._id),
      noteNumber: n.noteNumber,
      noteDate: n.noteDate,
      reason: n.reason,
      status: n.status,
      kind: n.kind ?? 'value',
      invoiceId: String(n.invoiceId),
      invoiceNumber: docNumber.get(String(n.invoiceId)) ?? null,
      customerId: String(n.customerId),
      customerName: partyName.get(String(n.customerId)) ?? 'Unknown',
      amountsPaise: n.amountsPaise,
      totalPaise: n.amountsPaise.total,
      journalId: String(n.journalId),
      lines: (n.lines ?? []).map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac ?? null,
        qty: l.qty,
        ratePaise: l.ratePaise,
        amountPaise: l.amountPaise,
        discountPaise: l.discountPaise ?? 0,
        taxRatePct: l.taxRatePct,
        accountId: String(l.accountId),
        accountName: accountNames.get(String(l.accountId)) ?? null,
      })),
      discount: n.discount ?? null,
      referenceNumber: n.referenceNumber ?? null,
      subject: n.subject ?? null,
      salespersonName: n.salespersonName ?? null,
      notes: n.notes ?? null,
      termsAndConditions: n.termsAndConditions ?? null,
    }));
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** The invoice a note is raised against, read inside the transaction: posted, and dated on or before the note. */
  private async postedInvoice(orgId: string, invoiceId: string, noteDate: string, session: ClientSession): Promise<SalesInvoiceDocument> {
    const doc = Types.ObjectId.isValid(invoiceId) ? await withOrg(orgId, () => this.docModel.findById(invoiceId).session(session).exec()) : null;
    if (!doc) throw new NotFoundException('SalesInvoice not found');
    if (doc.status !== InvoiceStatus.POSTED && doc.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(`Only a posted invoice can take a credit note (this one is ${doc.status})`);
    }
    if (noteDate < doc.invoiceDate) {
      throw new BadRequestException('A credit note cannot be dated before the invoice it corrects');
    }
    return doc;
  }

  /**
   * Post the note's CREDIT_NOTE voucher and record it, inside the caller's
   * transaction. What the note takes off the invoice is what it still owes;
   * anything beyond was already paid, and becomes the customer's credit (an
   * advance). The debits are the income lines; tax and the credits are added here.
   */
  private async raise(
    orgId: string,
    actorId: string,
    session: ClientSession,
    doc: SalesInvoiceDocument,
    input: { noteDate: string; reason: string; amounts: TaxSplit; debits: Debit[]; record: Partial<CreditNote> & { kind: 'value' | 'itemised' } },
  ): Promise<CreditNoteDocument> {
    const { amounts } = input;
    const docLabel = `Invoice ${doc.invoiceNumber ?? doc._id}`;
    const owed = outstandingPaise(doc);
    const offInvoice = Math.min(amounts.total, owed);
    const excess = amounts.total - offInvoice;
    if (excess > 0 && !this.payments) {
      throw new BadRequestException(`A credit note of ${rupees(amounts.total)} is more than the ${rupees(owed)} still owed on ${docLabel}`);
    }

    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.ACCOUNTS_RECEIVABLE,
      SystemAccountKey.CUSTOMER_ADVANCES,
      ...TAX_KEYS.map(([, key]) => key),
    ]);
    const control = accounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!;
    const lines: Debit[] = [...input.debits];
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
          ...input.record,
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
        after: { noteNumber: note.noteNumber, kind: input.record.kind, invoiceId: String(doc._id), totalPaise: amounts.total, reason: input.reason, toCustomerCreditPaise: excess },
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
  }

  /** Each account a line names, checked to be one of this org's income accounts that can take postings; id → name. */
  private async incomeAccounts(orgId: string, ids: string[], session: ClientSession): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('No such account.');
    const found = await this.accountModel!.find({ orgId, _id: { $in: unique.map((id) => new Types.ObjectId(id)) } }, { name: 1, type: 1, isGroup: 1, isActive: 1 }).session(session).lean().exec();
    const byId = new Map(found.map((a) => [String(a._id), a]));
    for (const id of unique) {
      const a = byId.get(id);
      if (!a) throw new BadRequestException('No such account.');
      if (a.type !== AccountType.INCOME) throw new BadRequestException(`${a.name} is not an income account. A credit note line comes back off income, such as Sales.`);
      if (a.isGroup) throw new BadRequestException(`${a.name} is a group; pick an account under it.`);
      if (a.isActive === false) throw new BadRequestException(`${a.name} is archived.`);
    }
    return new Map(found.map((a) => [String(a._id), a.name]));
  }

  /** For an invoice that charged no tax: whether the customer is in another state, as recorded now. */
  private async interStateNow(orgId: string, customerId: Types.ObjectId): Promise<boolean> {
    const [settings, customer] = await Promise.all([
      this.settingsModel!.findOne({ orgId }).lean().exec(),
      this.partyModel.findOne({ _id: customerId, orgId }).lean().exec(),
    ]);
    return isInterState(settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null, customer?.gstin?.slice(0, 2) ?? customer?.stateCode ?? null);
  }

  /**
   * The ledger the invoice posted its sales to: the largest credit line
   * on its journal that is not tax, round-off or the receivable.
   */
  private async originalLedgers(
    journalId: Types.ObjectId | null,
    exclude: Set<string>,
    fallback: { _id: Types.ObjectId; name: string },
    orgId: string,
    session: ClientSession,
  ): Promise<Array<{ _id: string; name: string; weight: number; projectId: string | null }>> {
    const journal = journalId
      ? await withOrg(orgId, () => this.journalModel.findById(journalId).session(session).lean().exec())
      : null;
    // Every account (and project) the original's value went to, so the note
    // comes back off each in the same proportion.
    const byAccount = new Map<string, { _id: string; name: string; weight: number; projectId: string | null }>();
    for (const l of journal?.lines ?? []) {
      if (l.creditPaise <= 0 || exclude.has(String(l.accountId))) continue;
      const id = String(l.accountId);
      const projectId = l.projectId ? String(l.projectId) : null;
      const key = `${id}|${projectId ?? ''}`;
      const entry = byAccount.get(key) ?? { _id: id, name: l.description || fallback.name, weight: 0, projectId };
      entry.weight += l.creditPaise;
      byAccount.set(key, entry);
    }
    return byAccount.size ? [...byAccount.values()] : [{ _id: String(fallback._id), name: fallback.name, weight: 1, projectId: null }];
  }
}
