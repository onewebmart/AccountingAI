import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus, ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { ItemsService } from '../items/items.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { AdjustmentsService, nextPeriod, periodEnd } from '../month-end/adjustments.service';
import { addDays, todayIst } from '../automation/schedule';
import { PeriodLock, PeriodLockDocument } from '../gl/schemas/period-lock.schema';
import { CURRENCIES, formatMinor, isForeign, rateProblem, toPaise } from './currencies';
import { ExchangeRate, ExchangeRateDocument } from './schemas/exchange-rate.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const rupees = (paise: number) => `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ForeignLineInput {
  description: string;
  itemId?: string | null;
  hsnSac?: string | null;
  uqc?: string | null;
  qty: number;
  /** Price of one unit in the currency's minor units: cents for USD. */
  rateMinor: number;
  projectId?: string | null;
}

type Foreign = NonNullable<SalesInvoice['foreign']>;

/**
 * Documents in foreign currencies. The books stay in INR paise: each line is
 * converted once at the document's rate, and the foreign amounts are kept
 * beside them. A payment is recorded in the currency at the day's rate; the
 * difference from the booked rate is a realised exchange gain or loss. At a
 * month's end, what is still open can be revalued as a proposal that
 * reverses on the 1st.
 */
@Injectable()
export class ForeignService {
  constructor(
    @InjectModel(ExchangeRate.name) private rateModel: Model<ExchangeRateDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    private items: ItemsService,
    private invoices: SalesInvoicesService,
    private bills: PurchaseBillsService,
    private posting: PostingService,
    private accounts: AccountsService,
    private adjustments: AdjustmentsService,
    private audit: AuditService,
    // Read only: an adjustment is not dated in a locked period (PostingService refuses it on approval anyway).
    @Optional() @InjectModel(PeriodLock.name) private lockModel?: Model<PeriodLockDocument>,
  ) {}

  // ── Rates ─────────────────────────────────────────────────────────────

  private currency(code: string) {
    const c = (code ?? '').toUpperCase();
    if (!isForeign(c)) throw new BadRequestException(`${code || 'That'} is not a currency we keep: ${Object.keys(CURRENCIES).join(', ')}.`);
    return c;
  }

  /** The day's rate, as a person enters it: the RBI/FBIL reference rate or the bank's. Entering it again replaces it. */
  async setRate(orgId: string, actorId: string, input: { currency: string; date: string; rate: number; source?: string | null }, session?: ClientSession) {
    const currency = this.currency(input.currency);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-04');
    const problem = rateProblem(input.rate);
    if (problem) throw new BadRequestException(problem);
    const before = await this.rateModel.findOne({ orgId, currency, date: input.date }).session(session ?? null).lean().exec();
    const saved = await this.rateModel
      .findOneAndUpdate({ orgId, currency, date: input.date }, { $set: { rate: input.rate, source: input.source?.trim() || null, enteredBy: actorId } }, { upsert: true, new: true, session })
      .exec();
    await this.audit.record({ orgId, entityType: 'ExchangeRate', entityId: String(saved._id), action: before ? 'UPDATE' : 'CREATE', performedBy: actorId, before: before ? { rate: before.rate, source: before.source } : null, after: { currency, date: input.date, rate: input.rate, source: input.source?.trim() || null } }, session);
    return saved;
  }

  async rates(orgId: string, currency?: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.rateModel.find({ orgId, ...(currency ? { currency: currency.toUpperCase() } : {}) }).sort({ date: -1, currency: 1 }).limit(200).lean().exec();
    return rows.map((r) => ({ id: String(r._id), currency: r.currency, date: r.date, rate: r.rate, source: r.source }));
  }

  /** The latest rate on or before a date. */
  async rateOn(orgId: string, currency: string, date: string): Promise<{ rate: number; date: string } | null> {
    const r = await this.rateModel.findOne({ orgId, currency, date: { $lte: date } }).sort({ date: -1 }).lean().exec();
    return r ? { rate: r.rate, date: r.date } : null;
  }

  private async rateFor(orgId: string, currency: string, date: string, given?: number | null) {
    if (given != null) {
      const problem = rateProblem(given);
      if (problem) throw new BadRequestException(problem);
      return given;
    }
    const found = await this.rateOn(orgId, currency, date);
    if (!found) throw new BadRequestException(`No ${currency} rate on or before ${date}: enter the day's rate first.`);
    return found.rate;
  }

  /** Each line converted once to paise; the foreign amounts kept beside. */
  private convert(lines: ForeignLineInput[], rate: number, digits: number) {
    if (!lines?.length) throw new BadRequestException('Add at least one line.');
    return lines.map((l, i) => {
      if (!l.description?.trim()) throw new BadRequestException(`Line ${i + 1} needs a description.`);
      if (!(l.qty > 0)) throw new BadRequestException(`Line ${i + 1}: the quantity is more than nothing.`);
      if (!Number.isInteger(l.rateMinor) || l.rateMinor < 0) throw new BadRequestException(`Line ${i + 1}: the price is a whole number of the currency's smallest unit.`);
      const minor = Math.round(l.qty * l.rateMinor);
      const paise = toPaise(minor, rate, digits);
      return { input: l, minor, paise, ratePaise: Math.round(paise / l.qty) };
    });
  }

  // ── Documents ─────────────────────────────────────────────────────────

  /**
   * An export invoice in the customer's currency, zero-rated under a letter
   * of undertaking: no GST, reported in GSTR-1 table 6A. A draft, posted as
   * any invoice is, in rupees at its rate.
   */
  async createInvoice(
    orgId: string,
    actorId: string,
    input: { customerId: string; currency?: string | null; rate?: number | null; invoiceNumber?: string | null; invoiceDate: string; dueDate?: string | null; lines: ForeignLineInput[]; shippingBill?: { number: string; date: string; portCode: string } | null; notes?: string | null },
  ) {
    const customer = Types.ObjectId.isValid(input.customerId) ? await this.customerModel.findOne({ _id: input.customerId, orgId }).lean().exec() : null;
    if (!customer) throw new NotFoundException('No such customer.');
    if (!DATE.test(input.invoiceDate ?? '')) throw new BadRequestException('invoiceDate must look like 2026-11-04');
    const currency = this.currency(input.currency ?? customer.currency);
    const { digits } = CURRENCIES[currency];
    const rate = await this.rateFor(orgId, currency, input.invoiceDate, input.rate);
    const lines = this.convert(input.lines, rate, digits);
    const resolved = await this.items.resolveLines(
      orgId,
      lines.map((l) => ({ description: l.input.description.trim(), itemId: l.input.itemId ?? null, hsnSac: l.input.hsnSac ?? null, uqc: l.input.uqc ?? null, qty: l.input.qty, ratePaise: l.ratePaise, amountPaise: l.paise, taxRatePct: 0, projectId: l.input.projectId ?? null })),
      'sale',
    );
    const taxable = lines.reduce((s, l) => s + l.paise, 0);
    const minor = lines.reduce((s, l) => s + l.minor, 0);
    const foreign: Foreign = { currency, digits, rate, taxableMinor: minor, totalMinor: minor, paidMinor: 0, linesMinor: lines.map((l) => l.minor) };
    return this.invoices.create({
      orgId, actorId, customerId: input.customerId, invoiceNumber: input.invoiceNumber ?? null, invoiceDate: input.invoiceDate, dueDate: input.dueDate ?? addDays(input.invoiceDate, 30),
      amountsPaise: { taxableValue: taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable },
      lineItems: resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: 0 })),
      notes: [input.notes?.trim(), `${formatMinor(minor, currency)} at ${rate} = ${rupees(taxable)}. Supply meant for export under LUT without payment of IGST.`].filter(Boolean).join('\n'),
      foreign, exportType: 'lut', shippingBill: input.shippingBill ?? null,
    });
  }

  /**
   * A bill in the vendor's currency. An import of services can carry IGST
   * under reverse charge, worked out on the rupee value; the vendor is owed
   * the foreign amount only.
   */
  async createBill(
    orgId: string,
    actorId: string,
    input: { vendorId: string; currency?: string | null; rate?: number | null; billNumber?: string | null; billDate: string; dueDate?: string | null; lines: ForeignLineInput[]; reverseChargeIgstPct?: number | null; notes?: string | null },
  ) {
    const vendor = Types.ObjectId.isValid(input.vendorId) ? await this.vendorModel.findOne({ _id: input.vendorId, orgId }).lean().exec() : null;
    if (!vendor) throw new NotFoundException('No such vendor.');
    if (!DATE.test(input.billDate ?? '')) throw new BadRequestException('billDate must look like 2026-11-04');
    const currency = this.currency(input.currency ?? vendor.currency);
    const { digits } = CURRENCIES[currency];
    const rate = await this.rateFor(orgId, currency, input.billDate, input.rate);
    const pct = input.reverseChargeIgstPct ?? 0;
    if (![0, 5, 12, 18, 28].includes(pct)) throw new BadRequestException('Reverse-charge IGST is 0, 5, 12, 18 or 28 per cent.');
    const lines = this.convert(input.lines, rate, digits);
    const resolved = await this.items.resolveLines(
      orgId,
      lines.map((l) => ({ description: l.input.description.trim(), itemId: l.input.itemId ?? null, hsnSac: l.input.hsnSac ?? null, uqc: l.input.uqc ?? null, qty: l.input.qty, ratePaise: l.ratePaise, amountPaise: l.paise, taxRatePct: pct, projectId: l.input.projectId ?? null })),
      'purchase',
    );
    const taxable = lines.reduce((s, l) => s + l.paise, 0);
    const igst = Math.round((taxable * pct) / 100);
    const minor = lines.reduce((s, l) => s + l.minor, 0);
    const foreign: Foreign = { currency, digits, rate, taxableMinor: minor, totalMinor: minor, paidMinor: 0, linesMinor: lines.map((l) => l.minor) };
    return this.bills.create({
      orgId, actorId, vendorId: input.vendorId, billNumber: input.billNumber ?? null, billDate: input.billDate, dueDate: input.dueDate ?? null,
      amountsPaise: { taxableValue: taxable, cgst: 0, sgst: 0, igst, cess: 0, total: taxable + igst },
      lineItems: resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: pct })),
      isReverseCharge: igst > 0,
      notes: [input.notes?.trim(), `${formatMinor(minor, currency)} at ${rate} = ${rupees(taxable)}.`].filter(Boolean).join('\n'),
      foreign,
    });
  }

  /** Foreign invoices and bills, newest first, with what is still owed in their currency. */
  async documents(orgId: string): Promise<Array<Record<string, unknown>>> {
    const [invoices, bills] = await Promise.all([
      this.invoiceModel.find({ orgId, foreign: { $ne: null } }).sort({ invoiceDate: -1 }).limit(200).lean().exec(),
      this.billModel.find({ orgId, foreign: { $ne: null } }).sort({ billDate: -1 }).limit(200).lean().exec(),
    ]);
    const [customers, vendors] = await Promise.all([
      this.customerModel.find({ orgId, _id: { $in: invoices.map((i) => i.customerId) } }, { name: 1 }).lean().exec(),
      this.vendorModel.find({ orgId, _id: { $in: bills.map((b) => b.vendorId) } }, { name: 1 }).lean().exec(),
    ]);
    const name = new Map([...customers, ...vendors].map((p) => [String(p._id), p.name]));
    const row = (kind: 'invoice' | 'bill', d: SalesInvoiceDocument | PurchaseBillDocument, number: string | null, date: string, partyId: unknown) => ({
      kind, id: String(d._id), number, date, status: d.status, party: name.get(String(partyId)) ?? '', currency: d.foreign!.currency, rate: d.foreign!.rate,
      totalMinor: d.foreign!.totalMinor, openMinor: d.foreign!.totalMinor - d.foreign!.paidMinor, digits: d.foreign!.digits, totalPaise: d.amountsPaise.total,
    });
    return [
      ...invoices.map((d) => row('invoice', d as SalesInvoiceDocument, d.invoiceNumber, d.invoiceDate, d.customerId)),
      ...bills.map((d) => row('bill', d as PurchaseBillDocument, d.billNumber, d.billDate, d.vendorId)),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  // ── Payments: the realised difference ─────────────────────────────────

  /**
   * Money in or out for a foreign document, in its currency at the day's
   * rate. The receivable or payable comes off at the booked rate (all that
   * is left of it when paid in full); bank moves at the day's rate; the
   * difference is a realised exchange gain or loss, in the same voucher.
   */
  async settle(orgId: string, actorId: string, kind: 'invoice' | 'bill', id: string, input: { paidOn: string; amountMinor: number; rate: number }) {
    if (!DATE.test(input.paidOn ?? '')) throw new BadRequestException('paidOn must look like 2026-11-04');
    const problem = rateProblem(input.rate);
    if (problem) throw new BadRequestException(problem);
    return this.posting.inTransaction(async (session: ClientSession) => {
      const model = (kind === 'invoice' ? this.invoiceModel : this.billModel) as unknown as Model<SalesInvoiceDocument | PurchaseBillDocument>;
      const doc = Types.ObjectId.isValid(id) ? await model.findOne({ _id: id, orgId }).session(session).exec() : null;
      if (!doc) throw new NotFoundException(`No such ${kind}.`);
      const f = doc.foreign;
      if (!f) throw new BadRequestException(`This ${kind} is in rupees: record its payment the usual way.`);
      const open = kind === 'invoice' ? InvoiceStatus.POSTED : BillStatus.POSTED;
      if (doc.status !== open) throw new BadRequestException(`Only a posted, unpaid ${kind} takes a payment (this one is ${doc.status}).`);
      const left = f.totalMinor - f.paidMinor;
      if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new BadRequestException(`A payment is a whole number of the ${f.currency}'s smallest unit, more than nothing.`);
      if (input.amountMinor > left) throw new BadRequestException(`${formatMinor(input.amountMinor, f.currency)} is more than the ${formatMinor(left, f.currency)} still owed.`);

      const owed = outstandingPaise(doc);
      const full = input.amountMinor === left;
      const booked = full ? owed : Math.min(owed, toPaise(input.amountMinor, f.rate, f.digits));
      const moved = toPaise(input.amountMinor, input.rate, f.digits);
      // Money in: more rupees than booked is a gain. Money out: more rupees than booked is a loss.
      const diff = kind === 'invoice' ? moved - booked : booked - moved;
      const acc = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.BANK, kind === 'invoice' ? SystemAccountKey.ACCOUNTS_RECEIVABLE : SystemAccountKey.ACCOUNTS_PAYABLE, SystemAccountKey.FX_GAIN, SystemAccountKey.FX_LOSS]);
      const bank = acc.get(SystemAccountKey.BANK)!;
      const party = acc.get(kind === 'invoice' ? SystemAccountKey.ACCOUNTS_RECEIVABLE : SystemAccountKey.ACCOUNTS_PAYABLE)!;
      const fxAccount = acc.get(diff > 0 ? SystemAccountKey.FX_GAIN : SystemAccountKey.FX_LOSS)!;
      const line = (a: { _id: Types.ObjectId; name: string }, debit: number, credit: number) => ({ accountId: a._id.toString(), description: a.name, debitPaise: debit, creditPaise: credit });
      const lines = kind === 'invoice' ? [line(bank, moved, 0), line(party, 0, booked)] : [line(party, booked, 0), line(bank, 0, moved)];
      if (diff > 0) lines.push(line(fxAccount, 0, diff));
      if (diff < 0) lines.push(line(fxAccount, -diff, 0));
      const number = (kind === 'invoice' ? (doc as SalesInvoiceDocument).invoiceNumber : (doc as PurchaseBillDocument).billNumber) ?? id;
      const journal = await this.posting.post(
        {
          orgId, voucherType: kind === 'invoice' ? VoucherType.RECEIPT : VoucherType.PAYMENT, financialYear: financialYearOf(input.paidOn), date: input.paidOn, postedBy: actorId, lines,
          narration: `${kind === 'invoice' ? 'Receipt for invoice' : 'Payment of bill'} ${number}: ${formatMinor(input.amountMinor, f.currency)} at ${input.rate} (booked at ${f.rate})${diff ? `, exchange ${diff > 0 ? 'gain' : 'loss'} ${rupees(diff)}` : ''}${full ? '' : ' (part)'}`,
        },
        session,
      );
      const updated = await model
        .findOneAndUpdate(
          { _id: doc._id, orgId, status: open, amountPaidPaise: doc.amountPaidPaise ?? 0, 'foreign.paidMinor': f.paidMinor },
          {
            $inc: { amountPaidPaise: booked, 'foreign.paidMinor': input.amountMinor },
            // The settlement records what it cleared at the booked rate; the bank amount is on the voucher.
            $push: { payments: { journalId: journal._id, amountPaise: booked, tdsPaise: 0, paidOn: input.paidOn, bankLineId: null } },
            $set: full ? { status: kind === 'invoice' ? InvoiceStatus.PAID : BillStatus.PAID, paidBy: actorId } : {},
          },
          { new: true, session },
        )
        .exec();
      if (!updated) throw new ConflictException('Another payment was recorded on this document meanwhile: reload and try again.');
      await this.audit.record(
        {
          orgId, entityType: kind === 'invoice' ? 'SalesInvoice' : 'PurchaseBill', entityId: id, action: 'RECORD_FOREIGN_PAYMENT', performedBy: actorId,
          before: { paidMinor: f.paidMinor, amountPaidPaise: doc.amountPaidPaise ?? 0 },
          after: { paidMinor: f.paidMinor + input.amountMinor, rate: input.rate, bookedPaise: booked, movedPaise: moved, exchangePaise: diff, journalId: String(journal._id) },
        },
        session,
      );
      return { journalId: String(journal._id), bookedPaise: booked, movedPaise: moved, exchangePaise: diff, paidInFull: full };
    });
  }

  // ── Month-end revaluation ─────────────────────────────────────────────

  /**
   * What is still open in foreign currencies, at the month-end rate against
   * the rupees it is booked at. Each currency needs a rate on or before the
   * month's last day.
   */
  async revaluation(orgId: string, period: string) {
    if (!PERIOD.test(period ?? '')) throw new BadRequestException('period is a month like 2026-11.');
    const date = periodEnd(period);
    // A currency given its own adjustment this month is left out: counting it again would double it.
    const live = (await this.adjustments.live(orgId, 'fx_revaluation')).filter((p) => p.adjustment?.period === period);
    const monthEnd = live.filter((p) => !p.adjustment?.refId?.startsWith('fx:'));
    const adjusted = [...new Set(live.filter((p) => p.adjustment?.refId?.startsWith('fx:')).map((p) => p.adjustment!.refId!.slice(3)))].sort();
    const docs = (await this.openForeign(orgId, date)).filter((x) => !adjusted.includes(x.d.foreign!.currency));
    const rates = new Map<string, number | null>();
    for (const c of new Set(docs.map((x) => x.d.foreign!.currency))) rates.set(c, (await this.rateOn(orgId, c, date))?.rate ?? null);
    const rows = docs.map((x) => this.valued(x, rates.get(x.d.foreign!.currency) ?? null));
    const missing = [...rates].filter(([, r]) => r === null).map(([c]) => c);
    const sum = (k: 'invoice' | 'bill') => rows.filter((r) => r.kind === k).reduce((s, r) => s + (r.differencePaise ?? 0), 0);
    return {
      period, date, rows, missingRates: missing, receivablesPaise: sum('invoice'), payablesPaise: sum('bill'),
      inReview: monthEnd.some((p) => p.status === ProposedEntryStatus.PROPOSED), approved: monthEnd.filter((p) => p.status === ProposedEntryStatus.APPROVED).length,
      adjustedCurrencies: adjusted,
    };
  }

  /**
   * The revaluation to the review queue: receivables up is a gain, payables
   * up a loss. It reverses itself on the 1st, so the documents stay at their
   * booked rate and only the month-end balance sheet moves.
   */
  async proposeRevaluation(orgId: string, actorId: string, period: string) {
    const r = await this.revaluation(orgId, period);
    if (r.missingRates.length) throw new BadRequestException(`Enter the ${r.missingRates.join(', ')} rate for ${r.date} first.`);
    if (r.inReview) throw new ConflictException(`A revaluation for ${period} is waiting in the review queue: approve or reject it first.`);
    if (r.approved) throw new ConflictException(`${period} is already revalued.`);
    if (!r.receivablesPaise && !r.payablesPaise) throw new ConflictException('Nothing to revalue: open foreign documents are at the month-end rate already.');
    const lines = await this.revaluationLines(orgId, r.receivablesPaise, r.payablesPaise);
    const said = (paise: number, side: string) => (paise ? `${side} ${paise > 0 ? 'up' : 'down'} ${rupees(paise)}` : null);
    const left = r.adjustedCurrencies.length ? ` ${r.adjustedCurrencies.join(', ')} ${r.adjustedCurrencies.length === 1 ? 'has' : 'have'} its own adjustment this month and ${r.adjustedCurrencies.length === 1 ? 'is' : 'are'} left out.` : '';
    return this.adjustments.propose({
      orgId, actorId, kind: 'fx_revaluation', refId: 'fx', period, date: r.date, unique: true,
      reverseOn: `${nextPeriod(period)}-01`,
      narration: `Revaluation of foreign-currency balances at ${r.date}`,
      reason: `${r.rows.length} open foreign document${r.rows.length === 1 ? '' : 's'} at the ${r.date} rates against their booked rates: ${[said(r.receivablesPaise, 'receivables'), said(r.payablesPaise, 'payables')].filter(Boolean).join(', ')}. Unrealised, so it reverses on ${nextPeriod(period)}-01.${left}`,
      lines,
    });
  }

  /** Posted, unpaid foreign invoices and bills dated on or before `date`; of one currency if given. */
  private async openForeign(orgId: string, date: string, currency?: string) {
    const which = currency ? { 'foreign.currency': currency } : { foreign: { $ne: null } };
    const [invoices, bills] = await Promise.all([
      this.invoiceModel.find({ orgId, status: InvoiceStatus.POSTED, ...which, invoiceDate: { $lte: date } }).sort({ invoiceDate: 1 }).lean().exec(),
      this.billModel.find({ orgId, status: BillStatus.POSTED, ...which, billDate: { $lte: date } }).sort({ billDate: 1 }).lean().exec(),
    ]);
    return [
      ...invoices.map((d) => ({ kind: 'invoice' as const, d: d as SalesInvoice & { _id: Types.ObjectId }, number: d.invoiceNumber, date: d.invoiceDate, partyId: String(d.customerId) })),
      ...bills.map((d) => ({ kind: 'bill' as const, d: d as PurchaseBill & { _id: Types.ObjectId }, number: d.billNumber, date: d.billDate, partyId: String(d.vendorId) })),
    ];
  }

  /** What is still owed on a document, at the rupees it is booked at and at a rate. */
  private valued(x: Awaited<ReturnType<ForeignService['openForeign']>>[number], rate: number | null) {
    const f = x.d.foreign!;
    const openMinor = f.totalMinor - f.paidMinor;
    const booked = outstandingPaise(x.d);
    const revalued = rate === null ? null : toPaise(openMinor, rate, f.digits);
    return { kind: x.kind, id: String(x.d._id), number: x.number, date: x.date, partyId: x.partyId, currency: f.currency, digits: f.digits, openMinor, bookedRate: f.rate, rate, bookedPaise: booked, revaluedPaise: revalued, differencePaise: revalued === null ? null : revalued - booked };
  }

  /**
   * The unrealised entry for receivables and payables moving by ar and ap:
   * receivables up is a gain, payables up a loss, netted per account.
   */
  private async revaluationLines(orgId: string, ar: number, ap: number) {
    const acc = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.ACCOUNTS_PAYABLE, SystemAccountKey.FX_GAIN, SystemAccountKey.FX_LOSS]);
    const id = (k: SystemAccountKey) => String(acc.get(k)!._id);
    const totals = new Map<string, { debit: number; credit: number }>();
    const add = (accountId: string, debit: number, credit: number) => {
      const t = totals.get(accountId) ?? { debit: 0, credit: 0 };
      totals.set(accountId, { debit: t.debit + debit, credit: t.credit + credit });
    };
    if (ar > 0) { add(id(SystemAccountKey.ACCOUNTS_RECEIVABLE), ar, 0); add(id(SystemAccountKey.FX_GAIN), 0, ar); }
    if (ar < 0) { add(id(SystemAccountKey.FX_LOSS), -ar, 0); add(id(SystemAccountKey.ACCOUNTS_RECEIVABLE), 0, -ar); }
    if (ap > 0) { add(id(SystemAccountKey.FX_LOSS), ap, 0); add(id(SystemAccountKey.ACCOUNTS_PAYABLE), 0, ap); }
    if (ap < 0) { add(id(SystemAccountKey.ACCOUNTS_PAYABLE), -ap, 0); add(id(SystemAccountKey.FX_GAIN), 0, -ap); }
    return [...totals].map(([accountId, t]) => {
      const net = t.debit - t.credit;
      return { accountId, debitPaise: Math.max(0, net), creditPaise: Math.max(0, -net) };
    });
  }

  // ── Base currency adjustments: one currency, a date and a rate ─────────

  /**
   * Why an adjustment for this currency and date cannot be made, or null:
   * the date is in a locked period; the month is already revalued at
   * month-end (every currency); or the currency already has one this month.
   * One a currency a month, because each reverses only on the 1st of the
   * next: two in a month would count the same difference twice.
   */
  private async adjustmentBlock(orgId: string, currency: string, date: string): Promise<string | null> {
    const lock = this.lockModel ? await this.lockModel.findOne({ orgId }).lean().exec() : null;
    if (lock?.lockedThrough && date <= lock.lockedThrough) return `The books are locked through ${lock.lockedThrough}: date the adjustment after that, or unlock the period first.`;
    const period = date.slice(0, 7);
    const live = (await this.adjustments.live(orgId, 'fx_revaluation')).filter((p) => p.adjustment?.period === period);
    const status = (p: { status: string }) => (p.status === ProposedEntryStatus.PROPOSED ? 'waiting in Review' : 'posted');
    const monthEnd = live.find((p) => !p.adjustment?.refId?.startsWith('fx:'));
    if (monthEnd) return `${monthName(period)} is already revalued at month-end for every currency (${status(monthEnd)}). Reject it in Review first, or adjust a later month.`;
    const same = live.find((p) => p.adjustment?.refId === `fx:${currency}`);
    if (same) return `${currency} already has an adjustment for ${monthName(period)}, dated ${same.invoiceDate} (${status(same)}). Reject it in Review first, or adjust a later month.`;
    return null;
  }

  /**
   * Open invoices and bills in one currency at a date, valued at a rate,
   * against the rupees they are booked at: what an adjustment would book.
   * Reads only. Bank accounts are kept in rupees, so no bank balance is
   * revalued.
   */
  async adjustmentPreview(orgId: string, input: { currency: string; date: string; rate: number }) {
    const currency = this.currency(input.currency);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-30');
    if (input.date > todayIst()) throw new BadRequestException('Date the adjustment today or earlier: a later day’s rate is not known yet.');
    const problem = rateProblem(input.rate);
    if (problem) throw new BadRequestException(problem);
    const period = input.date.slice(0, 7);
    const docs = await this.openForeign(orgId, input.date, currency);
    const [customers, vendors] = await Promise.all([
      this.customerModel.find({ orgId, _id: { $in: docs.filter((x) => x.kind === 'invoice').map((x) => new Types.ObjectId(x.partyId)) } }, { name: 1 }).lean().exec(),
      this.vendorModel.find({ orgId, _id: { $in: docs.filter((x) => x.kind === 'bill').map((x) => new Types.ObjectId(x.partyId)) } }, { name: 1 }).lean().exec(),
    ]);
    const names = new Map([...customers, ...vendors].map((p) => [String(p._id), p.name]));
    const rows = docs.map((x) => {
      const v = this.valued(x, input.rate);
      // Money owed to us worth more is a gain; money we owe worth more, a loss.
      const gainPaise = x.kind === 'invoice' ? v.differencePaise! : -v.differencePaise!;
      return { ...v, party: names.get(x.partyId) ?? '', gainPaise };
    });
    const receivablesPaise = rows.filter((r) => r.kind === 'invoice').reduce((s, r) => s + r.differencePaise!, 0);
    const payablesPaise = rows.filter((r) => r.kind === 'bill').reduce((s, r) => s + r.differencePaise!, 0);
    return {
      currency, digits: CURRENCIES[currency].digits, date: input.date, rate: input.rate, period, reverseOn: `${nextPeriod(period)}-01`,
      rows, receivablesPaise, payablesPaise, gainPaise: receivablesPaise - payablesPaise,
      bookedPaise: rows.reduce((s, r) => s + (r.kind === 'invoice' ? r.bookedPaise : -r.bookedPaise), 0),
      blocked: await this.adjustmentBlock(orgId, currency, input.date),
    };
  }

  /**
   * A base-currency adjustment to the review queue: open documents in one
   * currency at the rate entered, the unrealised gain or loss against what
   * they are booked at, by the same entry and accounts as the month-end
   * revaluation, reversing on the 1st of the next month. The rate is saved
   * as that day's rate, in the same transaction. A person approves it in
   * Review; nothing posts here.
   */
  async proposeAdjustment(orgId: string, actorId: string, input: { currency: string; date: string; rate: number; notes: string }) {
    const notes = (input.notes ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!notes) throw new BadRequestException('Add a note: why the rate is being adjusted, or where it comes from.');
    const p = await this.adjustmentPreview(orgId, input);
    if (p.blocked) throw new ConflictException(p.blocked);
    if (!p.rows.length) throw new ConflictException(`Nothing is open in ${p.currency} on ${p.date}: there is nothing to adjust.`);
    if (!p.receivablesPaise && !p.payablesPaise) throw new ConflictException(`The open ${p.currency} documents are worth the same at ${p.rate}: there is nothing to adjust.`);
    const lines = await this.revaluationLines(orgId, p.receivablesPaise, p.payablesPaise);
    const said = (paise: number, side: string) => (paise ? `${side} ${paise > 0 ? 'up' : 'down'} ${rupees(paise)}` : null);
    const outcome = p.gainPaise === 0 ? 'no gain or loss overall' : `an unrealised ${p.gainPaise > 0 ? 'gain' : 'loss'} of ${rupees(p.gainPaise)}`;
    const existing = await this.rateModel.findOne({ orgId, currency: p.currency, date: p.date }).lean().exec();
    const proposal = await this.posting.inTransaction(async (session) => {
      if (existing?.rate !== p.rate) await this.setRate(orgId, actorId, { currency: p.currency, date: p.date, rate: p.rate, source: 'Base currency adjustment' }, session);
      return this.adjustments.propose({
        orgId, actorId, kind: 'fx_revaluation', refId: `fx:${p.currency}`, period: p.period, date: p.date, unique: true,
        reverseOn: p.reverseOn,
        narration: `Base currency adjustment: ${p.currency} at ${p.rate} on ${p.date}`,
        reason:
          `${notes.replace(/[.!?]?$/, '.')} ${p.rows.length} open ${p.currency} document${p.rows.length === 1 ? '' : 's'} at 1 ${p.currency} = ₹${p.rate} against their booked rates: ` +
          `${[said(p.receivablesPaise, 'receivables'), said(p.payablesPaise, 'payables')].filter(Boolean).join(', ')}; ${outcome}. Unrealised, so it reverses on ${p.reverseOn}.`,
        lines,
        fx: { currency: p.currency, rate: p.rate, notes, gainPaise: p.gainPaise, receivablesPaise: p.receivablesPaise, payablesPaise: p.payablesPaise, documents: p.rows.length },
      }, session);
    });
    return { proposalId: String(proposal._id), currency: p.currency, date: p.date, rate: p.rate, gainPaise: p.gainPaise, receivablesPaise: p.receivablesPaise, payablesPaise: p.payablesPaise, documents: p.rows.length, reverseOn: p.reverseOn };
  }

  /**
   * Base-currency adjustments and month-end revaluations, newest first:
   * in Review, posted, or posted and reversed on the 1st. Rejected ones are
   * left out; nothing of theirs reached the books.
   */
  async adjustmentsList(orgId: string, q: { currency?: string; from?: string; to?: string } = {}) {
    const currency = q.currency ? this.currency(q.currency) : null;
    for (const d of [q.from, q.to]) if (d && !DATE.test(d)) throw new BadRequestException('Dates look like 2026-11-30.');
    const found = (await this.adjustments.live(orgId, 'fx_revaluation'))
      .filter((p) => (!currency || p.adjustment?.refId === `fx:${currency}`) && (!q.from || p.invoiceDate! >= q.from) && (!q.to || p.invoiceDate! <= q.to))
      .sort((a, b) => (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? '') || String(b._id).localeCompare(String(a._id)))
      .slice(0, 200);
    const acc = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.FX_GAIN, SystemAccountKey.FX_LOSS]);
    // Gain or loss read off the entry: credits to either exchange account less debits.
    const fxAccounts = new Set([String(acc.get(SystemAccountKey.FX_GAIN)!._id), String(acc.get(SystemAccountKey.FX_LOSS)!._id)]);
    return found.map((p) => {
      const a = p.adjustment!;
      const fx = a.fx ?? null;
      const gainPaise = fx?.gainPaise ?? p.suggestedLines.reduce((s, l) => s + (fxAccounts.has(String(l.accountId)) ? l.creditPaise - l.debitPaise : 0), 0);
      const status = p.status === ProposedEntryStatus.PROPOSED ? 'in_review' : a.reversalJournalId ? 'reversed' : 'posted';
      return {
        proposalId: String(p._id), kind: a.refId?.startsWith('fx:') ? 'currency' as const : 'month_end' as const, date: p.invoiceDate, period: a.period,
        currency: fx?.currency ?? null, rate: fx?.rate ?? null, notes: fx?.notes ?? null, documents: fx?.documents ?? null, gainPaise, status,
        journalId: p.journalId ? String(p.journalId) : null, reversalJournalId: a.reversalJournalId && a.reversalJournalId !== 'manual' ? a.reversalJournalId : null, reverseOn: a.reverseOn ?? null, narration: p.narration,
      };
    });
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (period: string) => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
