import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, BillStatus } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { FixedAsset, FixedAssetDocument } from './schemas/fixed-asset.schema';
import { AdjustmentsService, nextPeriod, periodEnd } from './adjustments.service';
import { AssetsService } from './assets.service';
import { SchedulesService, schedulePeriods } from './schedules.service';
import { AdjustmentSchedule, AdjustmentScheduleDocument } from './schemas/adjustment-schedule.schema';
import { BillFact, annualCosts, capitalCandidates, missingRecurringBills } from './assistant';
import { Item, ItemDocument } from '../items/schemas/item.schema';

/** The assistant's guesses go to the queue below full confidence: a person checks them. */
const GUESS_CONFIDENCE = 0.7;

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthsBefore = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
};

/**
 * Before close: what the month still needs, from the books, with reasons.
 * Rules, no model: every figure is computed. Its entries go to the review
 * queue; nothing posts until a person approves.
 */
@Injectable()
export class AssistantService {
  constructor(
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(FixedAsset.name) private assetModel: Model<FixedAssetDocument>,
    @InjectModel(AdjustmentSchedule.name) private scheduleModel: Model<AdjustmentScheduleDocument>,
    private adjustments: AdjustmentsService,
    private assets: AssetsService,
    private schedules: SchedulesService,
    private accounts: AccountsService,
    // Read only: which bill lines are stock bought to sell.
    @Optional() @InjectModel(Item.name) private itemModel?: Model<ItemDocument>,
  ) {}

  async suggestions(orgId: string, period: string) {
    if (!PERIOD.test(period ?? '')) throw new BadRequestException('period is a month like 2026-11.');
    const facts = await this.billFacts(orgId, monthsBefore(period, 3), period);

    const accrualsLive = new Set((await this.adjustments.live(orgId, 'accrual')).filter((p) => p.adjustment?.period === period).map((p) => p.adjustment?.refId));
    const accruals = missingRecurringBills(period, facts).filter((c) => !accrualsLive.has(`vendor:${c.vendorId}`));

    const reclassed = new Set((await this.adjustments.live(orgId, 'reclass')).map((p) => p.adjustment?.refId));
    const prepaids = annualCosts(period, facts).filter((c) => !reclassed.has(c.billId));

    const registered = new Set((await this.assetModel.find({ orgId, billId: { $ne: null }, status: { $ne: 'cancelled' } }, { billId: 1 }).lean().exec()).map((a) => String(a.billId)));
    const capitalise = capitalCandidates(period, facts).filter((c) => !registered.has(c.billId));
    const assetAccounts = await this.accountModel.find({ orgId, type: AccountType.ASSETS, isGroup: false, isActive: true, systemKey: { $exists: false } }, { name: 1 }).lean().exec();
    const accountFor = (category: string) => {
      const want = category === 'computers' || category === 'servers' || category === 'software' ? /computer|it equipment/i : category === 'furniture' ? /furniture/i : category === 'vehicles' ? /vehicle|motor|car/i : /equipment|plant|machinery/i;
      return assetAccounts.find((a) => want.test(a.name)) ?? null;
    };

    const register = await this.assets.list(orgId, periodEnd(period));
    const depLive = (await this.adjustments.live(orgId, 'depreciation')).some((p) => p.adjustment?.period === period);
    const depreciationDue = register.reduce((s, a) => s + a.dueToDatePaise, 0);

    const schedules = await this.scheduleModel.find({ orgId, status: 'active', startPeriod: { $lte: period } }).lean().exec();
    let undrafted = 0;
    for (const s of schedules) {
      const done = new Set((await this.adjustments.live(orgId, s.kind, String(s._id))).map((p) => p.adjustment?.period));
      undrafted += schedulePeriods(s).filter((p) => p <= period && !done.has(p)).length;
    }

    return {
      period,
      depreciation: depLive || depreciationDue === 0 ? null : { amountPaise: depreciationDue, assets: register.filter((a) => a.dueToDatePaise > 0).length, reason: `Depreciation is due on the register to ${periodEnd(period)}.` },
      schedules: undrafted ? { entries: undrafted, reason: `${undrafted} scheduled accrual or prepaid entr${undrafted === 1 ? 'y is' : 'ies are'} not drafted yet.` } : null,
      accruals,
      prepaids,
      capitalise: capitalise.map((c) => ({ ...c, suggestedAssetAccount: accountFor(c.category) ? { id: String(accountFor(c.category)!._id), name: accountFor(c.category)!.name } : null })),
    };
  }

  /** Draft what is due: scheduled entries, the accruals for missing bills, and depreciation. */
  async proposeAll(orgId: string, actorId: string, period: string) {
    const s = await this.suggestions(orgId, period);
    const { drafted } = await this.schedules.draftDue(orgId, actorId, period);
    const accrued = await this.accrualAccount(orgId);
    let accruals = 0;
    for (const c of s.accruals) {
      try {
        await this.adjustments.propose({
          orgId, actorId, kind: 'accrual', refId: `vendor:${c.vendorId}`, period, date: periodEnd(period),
          narration: `${c.vendorName}: accrued for ${period}`, reason: c.reason, confidence: GUESS_CONFIDENCE,
          lines: [
            { accountId: c.accountId, debitPaise: c.amountPaise, creditPaise: 0 },
            { accountId: accrued, debitPaise: 0, creditPaise: c.amountPaise },
          ],
          reverseOn: `${nextPeriod(period)}-01`,
          unique: true,
        });
        accruals++;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    }
    let depreciation = false;
    if (s.depreciation) {
      try {
        await this.assets.run(orgId, actorId, period);
        depreciation = true;
      } catch (err) {
        if (!(err instanceof ConflictException) && !(err instanceof BadRequestException)) throw err;
      }
    }
    return { scheduled: drafted, accruals, depreciation };
  }

  /**
   * Spread a year's cost: this month keeps a twelfth; the rest moves to
   * Prepaid Expenses now and comes back a twelfth a month for eleven months.
   */
  async spread(orgId: string, actorId: string, period: string, billId: string) {
    const candidate = (await this.suggestions(orgId, period)).prepaids.find((p) => p.billId === billId);
    if (!candidate) throw new NotFoundException('That bill is not one to spread, or is spread already.');
    const later = candidate.amountPaise - Math.round(candidate.amountPaise / 12);
    const prepaid = await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.PREPAID_EXPENSES);
    const proposal = await this.adjustments.propose({
      orgId, actorId, kind: 'reclass', refId: billId, period, date: periodEnd(period),
      narration: `${candidate.description}: eleven months to Prepaid Expenses`,
      reason: candidate.reason, confidence: GUESS_CONFIDENCE,
      lines: [
        { accountId: String(prepaid._id), debitPaise: later, creditPaise: 0 },
        { accountId: candidate.accountId, debitPaise: 0, creditPaise: later },
      ],
      unique: true,
    });
    const schedule = await this.schedules.create(orgId, actorId, {
      kind: 'prepaid', name: candidate.description.slice(0, 120), expenseAccountId: candidate.accountId, amountPaise: later, startPeriod: nextPeriod(period), months: 11,
      note: `From bill ${billId}, spread by the month-end assistant.`,
    });
    return { proposal, schedule };
  }

  private async accrualAccount(orgId: string) {
    return String((await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ACCRUED_EXPENSES))._id);
  }

  /** Posted bills in the window, each with the account its value was debited to. */
  private async billFacts(orgId: string, fromPeriod: string, toPeriod: string): Promise<BillFact[]> {
    const bills = await this.billModel
      .find({ orgId, status: { $in: [BillStatus.POSTED, BillStatus.PAID] }, isOpeningBalance: { $ne: true }, billDate: { $gte: `${fromPeriod}-01`, $lte: `${toPeriod}-31` } })
      .lean()
      .exec();
    const itemIds = [...new Set(bills.flatMap((b) => (b.lineItems ?? []).flatMap((l) => (l.itemId ? [String(l.itemId)] : []))))];
    const [vendors, journals, stocked] = await Promise.all([
      this.vendorModel.find({ orgId, _id: { $in: bills.map((b) => b.vendorId) } }, { name: 1 }).lean().exec(),
      this.journalModel.find({ orgId, _id: { $in: bills.map((b) => b.journalId).filter(Boolean) } }, { lines: 1 }).lean().exec(),
      itemIds.length && this.itemModel
        ? this.itemModel.find({ orgId, _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) }, kind: 'goods', trackStock: true }, { _id: 1 }).lean().exec()
        : Promise.resolve([]),
    ]);
    const inStock = new Set(stocked.map((i) => String(i._id)));
    const accountIds = [...new Set(journals.flatMap((j) => j.lines.filter((l) => l.debitPaise > 0).map((l) => String(l.accountId))))];
    const accounts = await this.accountModel.find({ orgId, _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) } }, { name: 1, type: 1, systemKey: 1 }).lean().exec();
    const accountById = new Map(accounts.map((a) => [String(a._id), a]));
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const journalById = new Map(journals.map((j) => [String(j._id), j]));
    const isTax = (key?: string) => !!key && /^GST_INPUT_/.test(key);
    return bills.map((b) => {
      const j = b.journalId ? journalById.get(String(b.journalId)) : undefined;
      const main = (j?.lines ?? [])
        .filter((l) => l.debitPaise > 0 && !isTax(accountById.get(String(l.accountId))?.systemKey))
        .sort((x, y) => y.debitPaise - x.debitPaise)[0];
      const account = main ? accountById.get(String(main.accountId)) : undefined;
      return {
        billId: String(b._id),
        vendorId: String(b.vendorId),
        vendorName: vendorName.get(String(b.vendorId)) ?? 'Unknown vendor',
        number: b.billNumber,
        date: b.billDate,
        taxablePaise: b.amountsPaise.taxableValue,
        accountId: account ? String(account._id) : null,
        accountName: account?.name ?? null,
        accountType: account ? (account.type === AccountType.EXPENSE ? 'EXPENSE' : account.type === AccountType.ASSETS ? 'ASSETS' : 'OTHER') : null,
        lines: (b.lineItems ?? []).map((l) => ({ description: l.description, hsnSac: l.hsnSac, amountPaise: l.amountPaise, stock: !!l.itemId && inStock.has(String(l.itemId)) })),
        isReverseCharge: b.isReverseCharge ?? false,
      };
    });
  }
}
