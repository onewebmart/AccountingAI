import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, ProposedEntryStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { todayIst } from '../automation/schedule';
import { FixedAsset, FixedAssetDocument } from './schemas/fixed-asset.schema';
import { AdjustmentsService, periodEnd } from './adjustments.service';
import { AssetCategory, AssetForDep, CATEGORIES, addDays, depreciationTo, taxBlocks } from './depreciation';

export interface AssetInput {
  name: string;
  category: AssetCategory;
  assetAccountId: string;
  costPaise: number;
  residualPaise?: number | null;
  purchaseDate: string;
  putToUse: string;
  method?: 'SLM' | 'WDV';
  lifeYears?: number | null;
  openingAccumulatedPaise?: number;
  openingAsOf?: string | null;
  billId?: string | null;
  /** The cost went to this expense account: move it into the asset account, through the review queue. */
  capitaliseFromAccountId?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const forDep = (a: FixedAsset): AssetForDep => ({
  costPaise: a.costPaise,
  residualPaise: a.residualPaise,
  putToUse: a.putToUse,
  method: a.method,
  lifeYears: a.lifeYears,
  openingAccumulatedPaise: a.openingAccumulatedPaise,
  openingAsOf: a.openingAsOf,
});

/**
 * The fixed asset register. Depreciation runs, capitalisations and
 * disposals are each one proposal in the review queue; an asset's booked
 * depreciation is read back from those proposals, so a rejected run simply
 * never happened and can be run again.
 */
@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(FixedAsset.name) private assetModel: Model<FixedAssetDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    private accounts: AccountsService,
    private adjustments: AdjustmentsService,
    private audit: AuditService,
  ) {}

  async create(orgId: string, actorId: string, input: AssetInput) {
    const category = CATEGORIES[input.category];
    if (!category) throw new BadRequestException('Pick a category.');
    if (!input.name?.trim()) throw new BadRequestException('Name the asset.');
    if (!Number.isInteger(input.costPaise) || input.costPaise < 1) throw new BadRequestException('The cost is whole paise, more than nothing.');
    for (const [label, d] of [['purchaseDate', input.purchaseDate], ['putToUse', input.putToUse]] as const) if (!DATE.test(d ?? '')) throw new BadRequestException(`${label} must look like 2026-11-04`);
    if (input.putToUse < input.purchaseDate) throw new BadRequestException('It cannot be put to use before it was bought.');
    const residualPaise = input.residualPaise ?? Math.round(input.costPaise * 0.05);
    if (!Number.isInteger(residualPaise) || residualPaise < 0 || residualPaise >= input.costPaise) throw new BadRequestException('The residual value is less than the cost.');
    const lifeYears = input.lifeYears ?? category.lifeYears;
    const opening = input.openingAccumulatedPaise ?? 0;
    if (opening && (!input.openingAsOf || !DATE.test(input.openingAsOf))) throw new BadRequestException('Give the date the opening depreciation runs to.');
    if (opening > input.costPaise - residualPaise) throw new BadRequestException('Opening depreciation is more than the asset can carry.');
    const assetAccount = await this.account(orgId, input.assetAccountId, [AccountType.ASSETS], 'asset');
    const from = input.capitaliseFromAccountId ? await this.account(orgId, input.capitaliseFromAccountId, [AccountType.EXPENSE], 'expense') : null;

    const asset = await this.assetModel.create({
      orgId, name: input.name.trim(), category: input.category, assetAccountId: assetAccount._id, costPaise: input.costPaise, residualPaise,
      purchaseDate: input.purchaseDate, putToUse: input.putToUse, method: input.method ?? 'SLM', lifeYears,
      openingAccumulatedPaise: opening, openingAsOf: opening ? input.openingAsOf : null,
      billId: input.billId && Types.ObjectId.isValid(input.billId) ? new Types.ObjectId(input.billId) : null,
      status: from ? 'pending' : 'active', createdBy: actorId,
    });
    if (from) {
      const proposal = await this.adjustments.propose({
        orgId, actorId, kind: 'capitalise', refId: String(asset._id), period: input.purchaseDate.slice(0, 7), date: input.purchaseDate,
        narration: `Capitalise ${asset.name}`,
        reason: `${asset.name} was booked to ${from.name}. Something kept and used for years is an asset: its cost moves to ${assetAccount.name} and is depreciated over ${lifeYears} years.`,
        lines: [
          { accountId: String(assetAccount._id), debitPaise: asset.costPaise, creditPaise: 0 },
          { accountId: String(from._id), debitPaise: 0, creditPaise: asset.costPaise },
        ],
        unique: true,
      });
      asset.capitaliseProposalId = proposal._id as Types.ObjectId;
      await asset.save();
    }
    await this.audit.record({ orgId, entityType: 'FixedAsset', entityId: asset._id.toString(), action: 'CREATE', performedBy: actorId, after: { name: asset.name, costPaise: asset.costPaise, method: asset.method, lifeYears, status: asset.status } });
    return asset;
  }

  /** The register as of a date: each asset with what is booked, what is due, and its book value. */
  async list(orgId: string, asOf = todayIst()) {
    const assets = await this.resolved(orgId);
    const booked = await this.bookedByAsset(orgId);
    return assets.map((a) => {
      const b = booked.get(String(a._id)) ?? { approved: 0, pending: 0, through: null };
      const end = a.disposal && a.status === 'disposed' ? a.disposal.date : asOf;
      const total = a.openingAccumulatedPaise + b.approved;
      return {
        ...a.toObject(),
        categoryLabel: CATEGORIES[a.category as AssetCategory]?.label ?? a.category,
        accumulatedPaise: total,
        pendingPaise: b.pending,
        depreciatedThrough: b.through ?? a.openingAsOf,
        dueToDatePaise: a.status === 'active' ? Math.max(0, depreciationTo(forDep(a), end) - total - b.pending) : 0,
        bookValuePaise: a.costPaise - total,
      };
    });
  }

  /** One proposal: each active asset's depreciation up to the period's end, less what is booked. */
  async run(orgId: string, actorId: string, period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new BadRequestException('period is a month like 2026-11.');
    const to = periodEnd(period);
    const assets = (await this.resolved(orgId)).filter((a) => a.status === 'active' && a.putToUse <= to);
    const booked = await this.bookedByAsset(orgId);
    const parts = assets
      .map((a) => {
        const b = booked.get(String(a._id)) ?? { approved: 0, pending: 0, through: null };
        const amount = depreciationTo(forDep(a), to) - a.openingAccumulatedPaise - b.approved - b.pending;
        const fromDate = b.through ? addDays(b.through, 1) : a.openingAsOf ? addDays(a.openingAsOf, 1) : a.putToUse;
        return { asset: a, amount, from: fromDate };
      })
      .filter((p) => p.amount > 0);
    if (parts.length === 0) throw new BadRequestException(`Nothing to depreciate up to ${to}: every asset is booked to there already.`);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    const [dep, acc] = await Promise.all([
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.DEPRECIATION),
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ACCUMULATED_DEPRECIATION),
    ]);
    return this.adjustments.propose({
      orgId, actorId, kind: 'depreciation', refId: 'run', period, date: to,
      narration: `Depreciation to ${to}`,
      reason: `Depreciation on ${parts.length} asset${parts.length === 1 ? '' : 's'} from the register, to ${to}: ${parts.map((p) => `${p.asset.name} ₹${(p.amount / 100).toFixed(2)}`).join(', ')}.`,
      lines: [
        { accountId: String(dep._id), debitPaise: total, creditPaise: 0 },
        { accountId: String(acc._id), debitPaise: 0, creditPaise: total },
      ],
      assets: parts.map((p) => ({ assetId: String(p.asset._id), amountPaise: p.amount, from: p.from, to })),
      unique: true,
    });
  }

  /** Sell or scrap: depreciation to the date, the asset out of the books, the gain or loss. */
  async dispose(orgId: string, actorId: string, id: string, input: { date: string; proceedsPaise: number; proceedsAccountId?: string | null }) {
    const asset = (await this.resolved(orgId)).find((a) => String(a._id) === id);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status !== 'active') throw new BadRequestException(`This asset is ${asset.status}.`);
    if (!DATE.test(input.date ?? '') || input.date < asset.putToUse) throw new BadRequestException('Give the date it was sold or scrapped, on or after it was put to use.');
    if (!Number.isInteger(input.proceedsPaise) || input.proceedsPaise < 0) throw new BadRequestException('Proceeds are whole paise; 0 if scrapped for nothing.');
    const b = (await this.bookedByAsset(orgId)).get(id) ?? { approved: 0, pending: 0, through: null };
    if (b.pending > 0) throw new ConflictException('A depreciation run for this asset is waiting in the review queue. Approve or reject it first.');
    if (b.through && b.through > input.date) throw new BadRequestException(`Depreciation is booked to ${b.through}. Dispose of it on or after that date.`);
    const booked = asset.openingAccumulatedPaise + b.approved;
    const stub = Math.max(0, depreciationTo(forDep(asset), input.date) - booked);
    const gain = input.proceedsPaise - (asset.costPaise - booked - stub);

    const [dep, acc, gainAcc, lossAcc, bank] = await Promise.all([
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.DEPRECIATION),
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ACCUMULATED_DEPRECIATION),
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ASSET_DISPOSAL_GAIN),
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ASSET_DISPOSAL_LOSS),
      this.accounts.resolveSystemAccount(orgId, SystemAccountKey.BANK),
    ]);
    const proceedsAccount = input.proceedsAccountId ? await this.account(orgId, input.proceedsAccountId, [AccountType.ASSETS], 'bank, cash or receivable') : bank;
    const proposal = await this.adjustments.propose({
      orgId, actorId, kind: 'disposal', refId: id, period: input.date.slice(0, 7), date: input.date,
      narration: `Disposal of ${asset.name}`,
      reason: `${asset.name}: cost ₹${(asset.costPaise / 100).toFixed(2)}, depreciation ₹${((booked + stub) / 100).toFixed(2)} (₹${(stub / 100).toFixed(2)} of it to ${input.date}), sold for ₹${(input.proceedsPaise / 100).toFixed(2)}: a ${gain >= 0 ? 'gain' : 'loss'} of ₹${(Math.abs(gain) / 100).toFixed(2)}.`,
      lines: [
        { accountId: String(dep._id), debitPaise: stub, creditPaise: 0 },
        { accountId: String(acc._id), debitPaise: booked, creditPaise: 0 },
        { accountId: String(proceedsAccount._id), debitPaise: input.proceedsPaise, creditPaise: 0 },
        { accountId: String(asset.assetAccountId), debitPaise: 0, creditPaise: asset.costPaise },
        gain >= 0 ? { accountId: String(gainAcc._id), debitPaise: 0, creditPaise: gain } : { accountId: String(lossAcc._id), debitPaise: -gain, creditPaise: 0 },
      ].filter((l) => l.debitPaise > 0 || l.creditPaise > 0),
      // The stub period's depreciation counts as booked once approved.
      assets: stub > 0 ? [{ assetId: id, amountPaise: stub, from: b.through ? addDays(b.through, 1) : asset.putToUse, to: input.date }] : [],
      unique: true,
    });
    await this.assetModel.updateOne({ _id: id, orgId }, { $set: { status: 'disposing', disposal: { date: input.date, proceedsPaise: input.proceedsPaise, proposalId: String(proposal._id) } } }).exec();
    await this.audit.record({ orgId, entityType: 'FixedAsset', entityId: id, action: 'DISPOSE', performedBy: actorId, before: { status: 'active' }, after: { status: 'disposing', date: input.date, proceedsPaise: input.proceedsPaise, gainPaise: gain } });
    return proposal;
  }

  /** Income Tax depreciation by block, for a financial year, from the register. */
  async taxReport(orgId: string, financialYear: string) {
    if (!/^\d{4}-\d{2}$/.test(financialYear ?? '')) throw new BadRequestException('financialYear is like 2026-27');
    const assets = (await this.resolved(orgId)).filter((a) => a.status === 'active' || a.status === 'disposed' || a.status === 'disposing');
    return {
      financialYear,
      blocks: taxBlocks(
        assets.map((a) => ({ id: String(a._id), name: a.name, category: a.category as AssetCategory, costPaise: a.costPaise, putToUse: a.putToUse, disposedOn: a.status === 'disposed' ? a.disposal?.date ?? null : null, proceedsPaise: a.disposal?.proceedsPaise ?? 0 })),
        financialYear,
      ),
      note: 'Worked out from the assets in this register since they were put to use. Assets bought before the register began need their opening tax written-down value from your tax records.',
    };
  }

  /** Assets, with pending capitalisations and disposals settled by what the review queue decided. */
  private async resolved(orgId: string): Promise<FixedAssetDocument[]> {
    const assets = await this.assetModel.find({ orgId, status: { $ne: 'cancelled' } }).sort({ putToUse: 1 }).exec();
    const waiting = assets.flatMap((a) => (a.status === 'pending' && a.capitaliseProposalId ? [String(a.capitaliseProposalId)] : a.status === 'disposing' && a.disposal ? [a.disposal.proposalId] : []));
    if (waiting.length === 0) return assets;
    const decided = new Map((await this.proposalModel.find({ orgId, _id: { $in: waiting } }, { status: 1 }).lean().exec()).map((p) => [String(p._id), p.status]));
    const out: FixedAssetDocument[] = [];
    for (const a of assets) {
      const pid = a.status === 'pending' ? String(a.capitaliseProposalId) : a.status === 'disposing' ? a.disposal!.proposalId : null;
      const status = pid ? decided.get(pid) : null;
      if (status === ProposedEntryStatus.APPROVED) a.status = a.status === 'pending' ? 'active' : 'disposed';
      else if (status === ProposedEntryStatus.REJECTED) {
        if (a.status === 'pending') a.status = 'cancelled';
        else { a.status = 'active'; a.disposal = null; }
      }
      if (a.isModified('status')) await a.save();
      if (a.status !== 'cancelled') out.push(a);
    }
    return out;
  }

  /** Depreciation in runs and disposals, per asset: approved, waiting, and the last date covered. */
  private async bookedByAsset(orgId: string) {
    const proposals = [...(await this.adjustments.live(orgId, 'depreciation')), ...(await this.adjustments.live(orgId, 'disposal'))];
    const out = new Map<string, { approved: number; pending: number; through: string | null }>();
    for (const p of proposals) {
      for (const x of p.adjustment?.assets ?? []) {
        const e = out.get(x.assetId) ?? { approved: 0, pending: 0, through: null };
        if (p.status === ProposedEntryStatus.APPROVED) e.approved += x.amountPaise;
        else e.pending += x.amountPaise;
        if (!e.through || x.to > e.through) e.through = x.to;
        out.set(x.assetId, e);
      }
    }
    return out;
  }

  private async account(orgId: string, id: string, types: AccountType[], label: string) {
    const a = Types.ObjectId.isValid(id) ? await this.accountModel.findOne({ _id: id, orgId }).lean().exec() : null;
    if (!a || a.isGroup || !a.isActive || !types.includes(a.type)) throw new BadRequestException(`Pick an active ${label} account.`);
    return a;
  }
}
