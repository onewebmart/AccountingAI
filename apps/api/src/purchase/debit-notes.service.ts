import { Optional, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BillStatus, VoucherType } from '@ai-accounting/shared';
import { DebitNote, DebitNoteDocument, DebitNoteLine } from './schemas/debit-note.schema';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { TaxSplit, addSplits, noteAmounts, rupees } from '../gl/note-amounts';
import { tdsOn } from '../gl/tds';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { formatVoucherNumber } from '../journals/journals.service';
import { withOrg } from '../database/tenant.plugin';
import { allocate } from '../gst/gst-returns';
import { ItemsService } from '../items/items.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { DiscountInput, DocLineInput, isInterState, lineAmount, lineProblem, lineTaxable, priceDoc, text } from '../orders/doc-lines';
import { bookableForBill } from './bills-from-lines.service';

export interface CreateDebitNoteInput {
  noteDate: string;
  reason: string;
  /** How much taxable value to take off; tax follows in the bill's proportions. */
  taxableValuePaise: number;
}

/** A line of a vendor credit: what goes back, and the account it comes back off. */
export interface DebitNoteLineInput extends DocLineInput {
  /** The item's account, else Purchases, when left out. */
  accountId?: string | null;
  /** This line's own discount, as on the bill ("at line item level"). */
  discount?: DiscountInput | null;
}

/**
 * A vendor credit, line by line, against the bill it corrects: priced and
 * taxed as that bill was, and posted when raised.
 */
export interface ItemisedDebitNoteInput {
  vendorId: string;
  billId: string;
  noteDate: string;
  /** Why it is raised; the subject, or "Vendor credit", when not given. */
  reason?: string | null;
  /** The vendor's own credit note number. */
  vendorCreditNumber?: string | null;
  orderNumber?: string | null;
  subject?: string | null;
  notes?: string | null;
  lines: DebitNoteLineInput[];
  discount?: DiscountInput | null;
  adjustment?: { label?: string | null; paise?: number | null } | null;
}

export interface DebitNoteListItem {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  kind: 'value' | 'itemised';
  billId: string;
  billNumber: string | null;
  vendorId: string;
  vendorName: string;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  totalPaise: number;
  journalId: string;
  lines: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; discountPaise: number; taxRatePct: number; accountId: string; accountName: string | null }>;
  discount: { percent: number | null; amountPaise: number } | null;
  discountLevel: 'transaction' | 'line' | null;
  adjustment: { label: string; paise: number } | null;
  vendorCreditNumber: string | null;
  orderNumber: string | null;
  subject: string | null;
  notes: string | null;
}

const TAX_KEYS = [
  ['cgst', SystemAccountKey.GST_INPUT_CGST],
  ['sgst', SystemAccountKey.GST_INPUT_SGST],
  ['igst', SystemAccountKey.GST_INPUT_IGST],
  ['cess', SystemAccountKey.GST_INPUT_CESS],
] as const;

type VoucherLine = { accountId: string; description: string; debitPaise: number; creditPaise: number; projectId?: string | null };

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
    // Optional for the same reason: a vendor credit typed line by line needs them.
    @Optional() private items?: ItemsService,
    @Optional() @InjectModel(LedgerAccount.name) private accountModel?: Model<LedgerAccountDocument>,
    @Optional() @InjectModel(OrgSettings.name) private settingsModel?: Model<OrgSettingsDocument>,
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
      const doc = await this.postedBill(orgId, billId, input.noteDate, session);
      const earlier = await withOrg(orgId, () =>
        this.noteModel.find({ billId: doc._id, status: 'posted' }).session(session).lean().exec(),
      );
      const amounts = noteAmounts(doc.amountsPaise, addSplits(earlier.map((n) => n.amountsPaise)), input.taxableValuePaise);
      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
        SystemAccountKey.PURCHASE_EXPENSE,
        SystemAccountKey.ACCOUNTS_PAYABLE,
        SystemAccountKey.ROUND_OFF,
        ...TAX_KEYS.map(([, key]) => key),
      ]);
      const mains = await this.originalLedgers(
        doc.journalId,
        new Set([accounts.get(SystemAccountKey.ACCOUNTS_PAYABLE)!, accounts.get(SystemAccountKey.ROUND_OFF)!, ...TAX_KEYS.map(([, key]) => accounts.get(key)!)].map((a) => String(a._id))),
        accounts.get(SystemAccountKey.PURCHASE_EXPENSE)!,
        orgId,
        session,
      );
      const shares = allocate(amounts.taxableValue, mains.map((m) => m.weight));
      const credits: VoucherLine[] = mains
        .map((m, i) => ({ accountId: m._id, description: m.name, debitPaise: 0, creditPaise: shares[i], projectId: m.projectId }))
        .filter((l, i) => l.creditPaise > 0 || i === 0);
      return this.raise(orgId, actorId, session, doc, { noteDate: input.noteDate, reason: input.reason, amounts, credits, record: { kind: 'value' } });
    });
  }

  /**
   * A vendor credit typed line by line against the bill it corrects, posted
   * when raised. It is taxed as the bill was (IGST, or CGST and SGST; under
   * reverse charge if the bill was), and can take back no more value, nor
   * any head of tax, than the bill has left after earlier notes. Each line
   * comes back off its account: the one chosen, else its item's, else
   * Purchases. The discount comes off before tax, as on a bill.
   */
  async createItemised(orgId: string, actorId: string, input: ItemisedDebitNoteInput): Promise<DebitNoteDocument> {
    if (!this.items || !this.accountModel || !this.settingsModel) throw new BadRequestException('A vendor credit by lines needs the items module.');
    const typed = (input.lines ?? []).filter((l) => l.description?.trim());
    if (typed.length === 0) throw new BadRequestException('Add at least one line.');
    typed.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(
      orgId,
      typed.map((l) => ({ description: l.description.trim(), itemId: l.itemId || null, hsnSac: l.hsnSac?.trim() || null, uqc: l.uqc || null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })),
      'purchase',
    );

    return this.postingService.inTransaction(async (session) => {
      const doc = await this.postedBill(orgId, input.billId, input.noteDate, session);
      if (String(doc.vendorId) !== input.vendorId) throw new BadRequestException('That bill is another vendor’s. Pick one of this vendor’s bills.');
      if (doc.foreign) throw new BadRequestException(`This bill is in ${doc.foreign.currency}: raise its debit note by value, from the bill.`);

      // A line comes back off the account it names, else its item's, else Purchases.
      const purchases = await this.accountsService.resolveSystemAccount(orgId, SystemAccountKey.PURCHASE_EXPENSE);
      const accountIds = resolved.map((l, i) => typed[i].accountId || (l.accountId ? String(l.accountId) : String(purchases._id)));
      const names = await this.bookable(orgId, accountIds, session);

      // Taxed as its bill was: IGST if that charged IGST, CGST and SGST if it charged those; else by where the vendor is.
      const a = doc.amountsPaise;
      const interState = a.igst > 0 ? true : a.cgst + a.sgst > 0 ? false : await this.interStateNow(orgId, doc.vendorId, session);
      const priced = priceDoc(
        resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })),
        interState,
        { discount: input.discount, adjustment: input.adjustment, lineDiscounts: typed.map((l) => l.discount ?? null) },
      );
      const amounts: TaxSplit = priced.amounts;
      if (amounts.total <= 0) throw new BadRequestException('A vendor credit needs an amount.');

      // Never more back than the bill has left, in value or in any tax.
      const earlier = await withOrg(orgId, () => this.noteModel.find({ billId: doc._id, status: 'posted' }).session(session).lean().exec());
      const noted = addSplits(earlier.map((n) => n.amountsPaise));
      const label = `bill ${doc.billNumber ?? doc._id}`;
      if (amounts.taxableValue > a.taxableValue - noted.taxableValue) {
        throw new BadRequestException(`Only ${rupees(a.taxableValue - noted.taxableValue)} of taxable value is left to take back on ${label}.`);
      }
      for (const head of ['cgst', 'sgst', 'igst', 'cess'] as const) {
        if (amounts[head] > a[head] - noted[head]) {
          throw new BadRequestException(`This credit takes back ${rupees(amounts[head])} of ${head.toUpperCase()}, more than the ${rupees(a[head] - noted[head])} left on ${label}. Check each line's GST rate against the bill.`);
        }
      }

      const byAccount = new Map<string, number>();
      priced.lines.forEach((l, i) => byAccount.set(accountIds[i], (byAccount.get(accountIds[i]) ?? 0) + lineTaxable(l)));
      const credits: VoucherLine[] = [...byAccount.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ accountId: id, description: names.get(id)!, debitPaise: 0, creditPaise: v }));
      const lines: DebitNoteLine[] = priced.lines.map((l, i) => ({
        description: l.description, itemId: l.itemId, hsnSac: l.hsnSac ?? null, uqc: l.uqc ?? null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise,
        discountPaise: l.discountPaise, discountPercent: l.discountPercent, taxRatePct: l.taxRatePct, accountId: new Types.ObjectId(accountIds[i]),
      }));
      const vendorCreditNumber = text(input.vendorCreditNumber, 40);
      return this.raise(orgId, actorId, session, doc, {
        noteDate: input.noteDate,
        reason: text(input.reason, 300) ?? text(input.subject, 300) ?? (vendorCreditNumber ? `Vendor credit ${vendorCreditNumber}` : 'Vendor credit'),
        amounts,
        credits,
        adjustment: priced.adjustment,
        record: {
          kind: 'itemised', lines, discount: priced.discount, discountLevel: priced.discountLevel, adjustment: priced.adjustment, vendorCreditNumber,
          orderNumber: text(input.orderNumber, 60), subject: text(input.subject, 250), notes: text(input.notes, 2000),
        },
      });
    });
  }

  async list(orgId: string, billId?: string): Promise<DebitNoteListItem[]> {
    if (billId !== undefined && !Types.ObjectId.isValid(billId)) return [];
    const filter = billId ? { billId: new Types.ObjectId(billId) } : {};
    const notes = await withOrg(orgId, () => this.noteModel.find(filter).sort({ noteDate: -1, noteNumber: -1 }).limit(200).lean().exec());
    const docIds = [...new Set(notes.map((n) => String(n.billId)))];
    const partyIds = [...new Set(notes.map((n) => String(n.vendorId)))];
    const accountIds = [...new Set(notes.flatMap((n) => (n.lines ?? []).map((l) => String(l.accountId))))];
    const [docs, parties, accountNames] = await Promise.all([
      withOrg(orgId, () => this.docModel.find({ _id: { $in: docIds } }).select('billNumber').lean().exec()),
      withOrg(orgId, () => this.partyModel.find({ _id: { $in: partyIds } }).select('name').lean().exec()),
      accountIds.length ? this.accountsService.namesOf(orgId, accountIds) : Promise.resolve(new Map<string, string>()),
    ]);
    const docNumber = new Map(docs.map((d) => [String(d._id), d.billNumber ?? null]));
    const partyName = new Map(parties.map((p) => [String(p._id), p.name]));
    return notes.map((n) => ({
      _id: String(n._id),
      noteNumber: n.noteNumber,
      noteDate: n.noteDate,
      reason: n.reason,
      status: n.status,
      kind: n.kind ?? 'value',
      billId: String(n.billId),
      billNumber: docNumber.get(String(n.billId)) ?? null,
      vendorId: String(n.vendorId),
      vendorName: partyName.get(String(n.vendorId)) ?? 'Unknown',
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
      discountLevel: n.discountLevel ?? null,
      adjustment: n.adjustment ?? null,
      vendorCreditNumber: n.vendorCreditNumber ?? null,
      orderNumber: n.orderNumber ?? null,
      subject: n.subject ?? null,
      notes: n.notes ?? null,
    }));
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** The bill a note is raised against, read inside the transaction: posted, and dated on or before the note. */
  private async postedBill(orgId: string, billId: string, noteDate: string, session: ClientSession): Promise<PurchaseBillDocument> {
    const doc = Types.ObjectId.isValid(billId) ? await withOrg(orgId, () => this.docModel.findById(billId).session(session).exec()) : null;
    if (!doc) throw new NotFoundException('PurchaseBill not found');
    if (doc.status !== BillStatus.POSTED && doc.status !== BillStatus.PAID) {
      throw new BadRequestException(`Only a posted bill can take a debit note (this one is ${doc.status})`);
    }
    if (noteDate < doc.billDate) {
      throw new BadRequestException('A debit note cannot be dated before the bill it corrects');
    }
    return doc;
  }

  /**
   * Post the note's DEBIT_NOTE voucher and record it, inside the caller's
   * transaction. The credits are the value lines; tax, payables, TDS, the
   * reverse-charge liability and any adjustment are added here.
   *
   * What the note takes off the vendor's balance is its total (its taxable
   * value and adjustment only under reverse charge, where the tax was never
   * theirs), less the share of the TDS deducted on that taxable value, which
   * comes back off TDS Payable instead. Anything beyond what is still owed
   * was already paid, and the vendor owes it back: their credit (an advance).
   */
  private async raise(
    orgId: string,
    actorId: string,
    session: ClientSession,
    doc: PurchaseBillDocument,
    note: {
      noteDate: string;
      reason: string;
      amounts: TaxSplit;
      credits: VoucherLine[];
      adjustment?: { label: string; paise: number } | null;
      record: Partial<Pick<DebitNote, 'kind' | 'lines' | 'discount' | 'discountLevel' | 'adjustment' | 'vendorCreditNumber' | 'orderNumber' | 'subject' | 'notes'>>;
    },
  ): Promise<DebitNoteDocument> {
    const docLabel = `Bill ${doc.billNumber ?? doc._id}`;
    const { amounts } = note;
    const adjustmentPaise = note.adjustment?.paise ?? 0;
    const owed = outstandingPaise(doc);
    const payablePart = doc.isReverseCharge ? amounts.taxableValue + adjustmentPaise : amounts.total;
    const noteTds = doc.tds ? Math.min(tdsOn(amounts.taxableValue, doc.tds.rateBps), doc.tds.amountPaise) : 0;
    const reduction = payablePart - noteTds;
    if (noteTds > 0 && doc.tds?.depositId) {
      throw new BadRequestException(
        `The TDS on ${docLabel} has already been deposited — a debit note now would need the TDS corrected in the return. Raise it after the next deposit is adjusted, or take it up with your CA.`,
      );
    }
    const offBill = Math.min(reduction, owed);
    const excess = reduction - offBill;
    if (excess > 0 && (!this.payments || noteTds > 0)) {
      throw new BadRequestException(
        `A debit note of ${rupees(reduction)} is more than the ${rupees(owed)} still owed on ${docLabel}` +
          (noteTds > 0 ? ': TDS was withheld on this bill, so raise the note before the bill is paid, or take it up with your CA' : ''),
      );
    }

    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.ACCOUNTS_PAYABLE,
      SystemAccountKey.ROUND_OFF,
      SystemAccountKey.TDS_PAYABLE,
      SystemAccountKey.RCM_GST_PAYABLE,
      SystemAccountKey.VENDOR_ADVANCES,
      ...TAX_KEYS.map(([, key]) => key),
    ]);
    const control = accounts.get(SystemAccountKey.ACCOUNTS_PAYABLE)!;
    const lines: VoucherLine[] = [...note.credits];
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
    const noteTax = amounts.cgst + amounts.sgst + amounts.igst + amounts.cess;
    if (doc.isReverseCharge && noteTax > 0) {
      // The reverse-charge liability on the returned part falls away with it.
      const rcm = accounts.get(SystemAccountKey.RCM_GST_PAYABLE)!;
      lines.push({ accountId: rcm._id.toString(), description: rcm.name, debitPaise: noteTax, creditPaise: 0 });
    }
    // The adjustment: the vendor's balance carries it, so Round Off takes the
    // other side: a credit when it adds to the note, a debit when it takes off.
    if (adjustmentPaise !== 0) {
      const roundOff = accounts.get(SystemAccountKey.ROUND_OFF)!;
      const label = note.adjustment?.label?.trim();
      lines.push({
        accountId: roundOff._id.toString(),
        description: label && label.toLowerCase() !== roundOff.name.toLowerCase() ? `${roundOff.name} — ${label}` : roundOff.name,
        debitPaise: adjustmentPaise < 0 ? -adjustmentPaise : 0,
        creditPaise: adjustmentPaise > 0 ? adjustmentPaise : 0,
      });
    }

    const financialYear = financialYearOf(note.noteDate);
    const journal = await this.postingService.post(
      {
        orgId,
        voucherType: VoucherType.DEBIT_NOTE,
        financialYear,
        date: note.noteDate,
        narration: `Debit note against ${docLabel} — ${note.reason}`,
        postedBy: actorId,
        lines,
      },
      session,
    );

    const noteId = new Types.ObjectId();
    const [created] = await this.noteModel.create(
      [
        {
          _id: noteId,
          orgId,
          billId: doc._id,
          vendorId: doc.vendorId,
          noteNumber: formatVoucherNumber(VoucherType.DEBIT_NOTE, financialYear, journal.voucherNumber),
          noteDate: note.noteDate,
          financialYear,
          reason: note.reason,
          amountsPaise: amounts,
          tdsPaise: noteTds,
          journalId: journal._id,
          createdBy: actorId,
          ...note.record,
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
                      noteDate: note.noteDate,
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
        { kind: 'payment', partyId: doc.vendorId as unknown as Types.ObjectId, partyName: vendor?.name ?? 'Vendor', date: note.noteDate, journalId: journal._id, noteNumber: created.noteNumber, excessPaise: excess },
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
        after: {
          noteNumber: created.noteNumber, billId: String(doc._id), totalPaise: amounts.total, reason: note.reason, kind: note.record.kind ?? 'value',
          ...(note.record.discount ? { discountPaise: note.record.discount.amountPaise } : {}),
          ...(adjustmentPaise ? { adjustmentPaise } : {}),
          ...(excess > 0 ? { vendorCreditPaise: excess } : {}),
        },
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
        after: { status: updated.status, adjustedPaise: updated.adjustedPaise, noteNumber: created.noteNumber },
      },
      session,
    );

    this.logger.log(`${created.noteNumber} raised against ${docLabel} for ${rupees(amounts.total)}`);
    return created;
  }

  /** The accounts vendor credit lines come back off, checked as a bill line's are, with their names. */
  private async bookable(orgId: string, ids: string[], session: ClientSession): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('That account is not one of yours.');
    const found = await this.accountModel!.find({ orgId, _id: { $in: unique.map((id) => new Types.ObjectId(id)) } }).session(session).lean().exec();
    const byId = new Map(found.map((a) => [String(a._id), a]));
    const names = new Map<string, string>();
    ids.forEach((id, i) => {
      const a = byId.get(id);
      if (!a) throw new BadRequestException(`Line ${i + 1}: that account is not one of yours.`);
      if (!bookableForBill(a)) throw new BadRequestException(`Line ${i + 1}: a vendor credit cannot come back off ${a.name}. Pick an expense account, or an asset such as equipment.`);
      names.set(id, a.name);
    });
    return names;
  }

  /** For a bill that charged no tax: inter-state when the vendor is registered in another state than ours. */
  private async interStateNow(orgId: string, vendorId: Types.ObjectId, session: ClientSession): Promise<boolean> {
    const [settings, vendor] = await Promise.all([
      this.settingsModel!.findOne({ orgId }).session(session).lean().exec(),
      this.partyModel.findOne({ _id: vendorId, orgId }, { gstin: 1 }).session(session).lean().exec(),
    ]);
    return isInterState(settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null, vendor?.gstin?.slice(0, 2) ?? null);
  }

  /**
   * The ledger the bill posted its expense to: the largest debit line
   * on its journal that is not tax, round-off or the payable.
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
      if (l.debitPaise <= 0 || exclude.has(String(l.accountId))) continue;
      const id = String(l.accountId);
      const projectId = l.projectId ? String(l.projectId) : null;
      const key = `${id}|${projectId ?? ''}`;
      const entry = byAccount.get(key) ?? { _id: id, name: l.description || fallback.name, weight: 0, projectId };
      entry.weight += l.debitPaise;
      byAccount.set(key, entry);
    }
    return byAccount.size ? [...byAccount.values()] : [{ _id: String(fallback._id), name: fallback.name, weight: 1, projectId: null }];
  }
}
