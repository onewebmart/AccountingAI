import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { msmePayBy } from '../purchase/msme';
import { todayIst } from '../automation/schedule';
import { PaymentRun, PaymentRunDocument } from './schemas/payment-run.schema';
import { PartyPaymentsService } from './party-payments.service';
import { bankFileCsv, PayableBill, suggestRun } from './payment-run';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Paying vendors in batches. A suggested run puts MSME bills first, then
 * overdue ones, then those due by the pay date, within any cash limit. The
 * person chooses, downloads the bank file, pays through the bank, and
 * records the run as paid: one payment per vendor, settling its bills.
 */
@Injectable()
export class PaymentRunsService {
  constructor(
    @InjectModel(PaymentRun.name) private runModel: Model<PaymentRunDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    private payments: PartyPaymentsService,
    private accounts: AccountsService,
    private audit: AuditService,
  ) {}

  /** The bills worth paying by `payOn`, ranked, with what the bank holds for context. */
  async suggest(orgId: string, input: { payOn: string; cashLimitPaise?: number | null }, today = todayIst()) {
    if (!DATE.test(input.payOn ?? '')) throw new BadRequestException('payOn must be a date like 2026-10-31');
    if (input.cashLimitPaise != null && (!Number.isInteger(input.cashLimitPaise) || input.cashLimitPaise < 0)) {
      throw new BadRequestException('The cash limit must be whole paise.');
    }
    const [bills, vendors, chart] = await Promise.all([
      this.billModel.find({ orgId, status: BillStatus.POSTED }).lean().exec(),
      this.vendorModel.find({ orgId }, { name: 1, msme: 1, bankAccount: 1 }).lean().exec(),
      this.accounts.list(orgId),
    ]);
    // Bills already in a draft run are not offered again.
    const drafted = new Set(
      (await this.runModel.find({ orgId, status: 'draft' }, { items: 1 }).lean().exec()).flatMap((r) => r.items.map((i) => String(i.billId))),
    );
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));
    const payable: PayableBill[] = bills
      .filter((b) => !drafted.has(String(b._id)))
      .map((b) => {
        const v = vendorById.get(String(b.vendorId));
        return {
          billId: String(b._id),
          vendorId: String(b.vendorId),
          vendorName: v?.name ?? 'Vendor',
          billNumber: b.billNumber ?? null,
          billDate: b.billDate,
          dueDate: b.dueDate ?? null,
          owedPaise: outstandingPaise(b),
          msmePayBy: msmePayBy(b.billDate, b.dueDate ?? null, v?.msme),
          hasBankAccount: !!v?.bankAccount,
        };
      });
    const { candidates, includedPaise } = suggestRun(payable, { today, payOn: input.payOn, cashLimitPaise: input.cashLimitPaise ?? null });
    const bank = chart.find((a) => a.systemKey === 'BANK');
    return { candidates, includedPaise, bankBalancePaise: bank?.balancePaise ?? 0 };
  }

  async create(orgId: string, actorId: string, input: { payOn: string; items: Array<{ billId: string; amountPaise: number }> }) {
    if (!DATE.test(input.payOn ?? '')) throw new BadRequestException('payOn must be a date like 2026-10-31');
    if (!input.items?.length) throw new BadRequestException('Choose at least one bill.');
    const ids = input.items.map((i) => i.billId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each bill can be in a run once.');
    const bills = await this.billModel.find({ orgId, _id: { $in: ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) } }).lean().exec();
    const byId = new Map(bills.map((b) => [String(b._id), b]));
    const drafted = new Set(
      (await this.runModel.find({ orgId, status: 'draft' }, { items: 1 }).lean().exec()).flatMap((r) => r.items.map((i) => String(i.billId))),
    );
    const vendors = new Map(
      (await this.vendorModel.find({ orgId, _id: { $in: bills.map((b) => b.vendorId) } }, { name: 1 }).lean().exec()).map((v) => [String(v._id), v.name]),
    );
    const items = input.items.map((i) => {
      const bill = byId.get(i.billId);
      if (!bill) throw new BadRequestException('One of the bills is not yours.');
      if (bill.status !== BillStatus.POSTED) throw new BadRequestException(`${bill.billNumber ?? 'A bill'} is ${bill.status}.`);
      if (drafted.has(i.billId)) throw new BadRequestException(`${bill.billNumber ?? 'A bill'} is already in another draft run.`);
      if (!Number.isInteger(i.amountPaise) || i.amountPaise <= 0 || i.amountPaise > outstandingPaise(bill)) {
        throw new BadRequestException(`${bill.billNumber ?? 'A bill'}: pay between ₹0.01 and what is owed.`);
      }
      return { billId: bill._id, vendorId: bill.vendorId, vendorName: vendors.get(String(bill.vendorId)) ?? 'Vendor', billNumber: bill.billNumber ?? null, amountPaise: i.amountPaise };
    });
    const run = await this.runModel.create({ orgId, payOn: input.payOn, items, totalPaise: items.reduce((s, i) => s + i.amountPaise, 0), createdBy: actorId });
    await this.audit.record({ orgId, entityType: 'PaymentRun', entityId: run._id.toString(), action: 'CREATE', performedBy: actorId, after: { payOn: run.payOn, bills: items.length, totalPaise: run.totalPaise } });
    return run;
  }

  async list(orgId: string) {
    return this.runModel.find({ orgId }).sort({ createdAt: -1 }).limit(50).lean().exec();
  }

  /** The bank file: one row per vendor. Every vendor in the run needs a bank account on file. */
  async bankFile(orgId: string, actorId: string, id: string): Promise<{ filename: string; csv: string }> {
    const run = await this.find(orgId, id);
    if (run.status !== 'draft') throw new BadRequestException(`This run is ${run.status}.`);
    const vendors = await this.vendorModel.find({ orgId, _id: { $in: run.items.map((i) => i.vendorId) } }, { name: 1, bankAccount: 1 }).lean().exec();
    const missing = vendors.filter((v) => !v.bankAccount).map((v) => v.name);
    if (missing.length) throw new BadRequestException(`Add bank details for ${missing.join(', ')} first, or take them out of the run.`);
    const byVendor = new Map<string, { amount: number; numbers: string[] }>();
    for (const i of run.items) {
      const k = String(i.vendorId);
      const v = byVendor.get(k) ?? { amount: 0, numbers: [] };
      v.amount += i.amountPaise;
      if (i.billNumber) v.numbers.push(i.billNumber);
      byVendor.set(k, v);
    }
    const csv = bankFileCsv(
      vendors.map((v) => {
        const t = byVendor.get(String(v._id))!;
        return {
          vendorName: v.name,
          accountName: v.bankAccount!.accountName,
          accountNumber: v.bankAccount!.accountNumber,
          ifsc: v.bankAccount!.ifsc,
          amountPaise: t.amount,
          narration: t.numbers.length ? `Bills ${t.numbers.join(' ')}` : 'Payment',
        };
      }),
    );
    await this.runModel.updateOne({ _id: run._id, orgId }, { $set: { exportedAt: new Date() } }).exec();
    await this.audit.record({ orgId, entityType: 'PaymentRun', entityId: id, action: 'EXPORT', performedBy: actorId, after: { vendors: vendors.length, totalPaise: run.totalPaise } });
    return { filename: `payment-run-${run.payOn}.csv`, csv };
  }

  /**
   * The bank has paid the run: record one payment per vendor, settling the
   * run's bills. Each vendor's payment commits on its own; one that cannot
   * (a bill paid meanwhile, say) is reported and the rest still record.
   */
  async markPaid(orgId: string, actorId: string, id: string, paidOn: string) {
    if (!DATE.test(paidOn ?? '')) throw new BadRequestException('paidOn must be a date like 2026-10-31');
    const run = await this.find(orgId, id);
    if (run.status !== 'draft') throw new BadRequestException(`This run is ${run.status}.`);
    const groups = new Map<string, typeof run.items>();
    for (const i of run.items) groups.set(String(i.vendorId), [...(groups.get(String(i.vendorId)) ?? []), i]);

    const paymentIds: Types.ObjectId[] = [];
    const failed: Array<{ vendorName: string; reason: string }> = [];
    for (const [vendorId, items] of groups) {
      try {
        const payment = await this.payments.record(orgId, actorId, {
          kind: 'payment',
          partyId: vendorId,
          date: paidOn,
          amountPaise: items.reduce((s, i) => s + i.amountPaise, 0),
          reference: `Payment run ${run.payOn}`,
          allocations: items.map((i) => ({ documentId: String(i.billId), amountPaise: i.amountPaise })),
        });
        paymentIds.push(payment._id);
      } catch (err) {
        failed.push({ vendorName: items[0].vendorName, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (paymentIds.length) {
      await this.runModel.updateOne({ _id: run._id, orgId }, { $set: { status: 'paid', paidOn }, $push: { paymentIds: { $each: paymentIds } } }).exec();
      await this.audit.record({ orgId, entityType: 'PaymentRun', entityId: id, action: 'PAID', performedBy: actorId, after: { paidOn, payments: paymentIds.length, failed: failed.length } });
    }
    return { recorded: paymentIds.length, failed };
  }

  async cancel(orgId: string, actorId: string, id: string) {
    const run = await this.find(orgId, id);
    if (run.status !== 'draft') throw new BadRequestException(`This run is ${run.status}.`);
    await this.runModel.updateOne({ _id: run._id, orgId }, { $set: { status: 'cancelled' } }).exec();
    await this.audit.record({ orgId, entityType: 'PaymentRun', entityId: id, action: 'CANCEL', performedBy: actorId, before: { status: 'draft' }, after: { status: 'cancelled' } });
    return { cancelled: true };
  }

  private async find(orgId: string, id: string): Promise<PaymentRunDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Payment run not found');
    const run = await this.runModel.findOne({ _id: id, orgId }).exec();
    if (!run) throw new NotFoundException('Payment run not found');
    return run;
  }
}
