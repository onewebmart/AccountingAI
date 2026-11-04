import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus, JournalStatus, ProposedEntryStatus } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockDocument } from '../gl/schemas/period-lock.schema';
import { ItemsService } from '../items/items.service';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import { UQC_CODES } from '../items/hsn';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { GoodsReceipt, GoodsReceiptDocument, PurchaseOrder, PurchaseOrderDocument } from '../orders/schemas/purchase-docs.schema';
import { PurchaseDocsService } from '../orders/purchase-docs.service';
import { AdjustmentKind, AdjustmentsService, periodEnd } from '../month-end/adjustments.service';
import { todayIst } from '../automation/schedule';
import { Move, itemLedger, reorder, summary } from './valuation';
import { LinkedLine, MappingItem, Suggestion, isServiceLine, suggestItem } from './line-mapping';
import { MoveReason, StockMove, StockMoveDocument } from './schemas/stock-move.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const threeDecimals = (n: number) => Number.isFinite(n) && Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DONE_BILL = [BillStatus.POSTED, BillStatus.PAID];
const DONE_INVOICE = [InvoiceStatus.POSTED, InvoiceStatus.PAID];
/** A purchase rate this far from the one before is worth a look. */
const PRICE_ALERT_PCT = 10;

const REASON_LABEL: Record<MoveReason, string> = {
  opening: 'Opening stock',
  count: 'Stock count',
  damaged: 'Damaged or lost',
  customer_return: 'Returned by a customer',
  vendor_return: 'Returned to a vendor',
  own_use: 'Taken for own use',
  other: 'Adjustment',
};

export type DocKind = 'bill' | 'invoice';

export interface LinkInput {
  docKind: DocKind;
  docId: string;
  line: number;
  itemId?: string | null;
  /** Create the item from the line, then link it. */
  newItem?: { name: string; hsnSac?: string | null; uqc?: string | null; gstRatePct?: number | null } | null;
  /** Not a stock item: stop asking. */
  notStock?: boolean;
}

/**
 * Stock under periodic inventory: purchases stay expensed as they post, and
 * what is on hand is booked once a period by a closing-stock entry through
 * the review queue. Quantities come from the posted bills and invoices
 * themselves (lines linked to a counted item), plus opening stock and
 * adjustments, valued at weighted-average cost. Nothing here writes to the
 * ledger.
 */
@Injectable()
export class StockService {
  constructor(
    @InjectModel(StockMove.name) private moveModel: Model<StockMoveDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(PurchaseOrder.name) private poModel: Model<PurchaseOrderDocument>,
    @InjectModel(GoodsReceipt.name) private grnModel: Model<GoodsReceiptDocument>,
    private accounts: AccountsService,
    private adjustments: AdjustmentsService,
    private items: ItemsService,
    private audit: AuditService,
    @Optional() @InjectModel(PeriodLock.name) private lockModel?: Model<PeriodLockDocument>,
    @Optional() private purchaseDocs?: PurchaseDocsService,
  ) {}

  // ── Moves and valuation ───────────────────────────────────────────────

  /** Goods counted in stock, archived ones too: their history still counts. */
  private async tracked(orgId: string) {
    const items = await this.itemModel.find({ orgId, kind: 'goods', trackStock: { $ne: false } }).lean().exec();
    return new Map(items.map((i) => [String(i._id), i]));
  }

  private async trackedItem(orgId: string, itemId: string) {
    const item = Types.ObjectId.isValid(itemId) ? (await this.tracked(orgId)).get(itemId) : undefined;
    if (!item) throw new NotFoundException('No such stock item: a service, or an item not counted in stock, has none.');
    return item;
  }

  /** Every move to a date: bill and invoice lines linked to a counted item, and the stored ones. */
  async moves(orgId: string, to: string, itemId?: string): Promise<Move[]> {
    const tracked = await this.tracked(orgId);
    const ids = itemId ? (tracked.has(itemId) ? [itemId] : []) : [...tracked.keys()];
    if (!ids.length) return [];
    const want = new Set(ids);
    const oids = ids.map((id) => new Types.ObjectId(id));
    const [bills, invoices, stored] = await Promise.all([
      this.billModel
        .find({ orgId, status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true }, billDate: { $lte: to }, 'lineItems.itemId': { $in: oids } }, { billDate: 1, billNumber: 1, lineItems: 1 })
        .lean()
        .exec(),
      this.invoiceModel
        .find({ orgId, status: { $in: DONE_INVOICE }, isOpeningBalance: { $ne: true }, invoiceDate: { $lte: to }, 'lineItems.itemId': { $in: oids } }, { invoiceDate: 1, invoiceNumber: 1, lineItems: 1 })
        .lean()
        .exec(),
      this.moveModel.find({ orgId, itemId: { $in: oids }, voidedAt: null, date: { $lte: to } }).lean().exec(),
    ]);
    const out: Move[] = [];
    for (const b of bills) {
      for (const l of b.lineItems ?? []) {
        const id = l.itemId ? String(l.itemId) : '';
        const qty = l.qty ?? 1;
        if (!want.has(id) || !(qty > 0)) continue;
        // At the line's taxable value: the GST on it is claimed, not a cost.
        out.push({ itemId: id, date: b.billDate, qty, ratePaise: Math.round(l.amountPaise / qty), valuePaise: l.amountPaise, source: { kind: 'bill', id: String(b._id), number: b.billNumber } });
      }
    }
    for (const inv of invoices) {
      for (const l of inv.lineItems ?? []) {
        const id = l.itemId ? String(l.itemId) : '';
        const qty = l.qty ?? 1;
        if (!want.has(id) || !(qty > 0)) continue;
        out.push({ itemId: id, date: inv.invoiceDate, qty: -qty, ratePaise: null, source: { kind: 'invoice', id: String(inv._id), number: inv.invoiceNumber } });
      }
    }
    for (const m of stored) {
      out.push({ itemId: String(m.itemId), date: m.date, qty: m.qty, ratePaise: m.ratePaise, source: { kind: m.kind, id: String(m._id), number: m.ref }, note: m.note || REASON_LABEL[m.reason] });
    }
    return out;
  }

  /** What is ordered from vendors and not yet received, per item. */
  private async onOrder(orgId: string): Promise<Map<string, number>> {
    const pos = await this.poModel.find({ orgId, status: 'open' }, { lines: 1 }).lean().exec();
    if (!pos.length) return new Map();
    const grns = await this.grnModel.find({ orgId, status: 'received', purchaseOrderId: { $in: pos.map((p) => p._id) } }, { purchaseOrderId: 1, lines: 1 }).lean().exec();
    const received = new Map<string, number>();
    for (const g of grns) for (const l of g.lines) received.set(`${g.purchaseOrderId}:${l.poLine}`, (received.get(`${g.purchaseOrderId}:${l.poLine}`) ?? 0) + l.qty);
    const out = new Map<string, number>();
    for (const po of pos) {
      po.lines.forEach((l, i) => {
        if (!l.itemId) return;
        const left = round3(l.qty - (received.get(`${po._id}:${i}`) ?? 0));
        if (left > 0) out.set(String(l.itemId), round3((out.get(String(l.itemId)) ?? 0) + left));
      });
    }
    return out;
  }

  /** Each item's purchases, latest first, one per vendor: who to buy from again, and at what. */
  private async lastPurchases(orgId: string, asOf: string) {
    const bills = await this.billModel
      .find({ orgId, status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true }, billDate: { $lte: asOf }, lineItems: { $elemMatch: { itemId: { $ne: null } } } }, { vendorId: 1, billDate: 1, billNumber: 1, lineItems: 1 })
      .sort({ billDate: -1, _id: -1 })
      .limit(1000)
      .lean()
      .exec();
    const vendors = await this.vendorModel.find({ orgId, _id: { $in: [...new Set(bills.map((b) => String(b.vendorId)))] } }, { name: 1 }).lean().exec();
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const out = new Map<string, Array<{ vendorId: string; vendorName: string; ratePaise: number; date: string; billNumber: string | null }>>();
    for (const b of bills) {
      for (const l of b.lineItems ?? []) {
        if (!l.itemId || !((l.qty ?? 1) > 0)) continue;
        const list = out.get(String(l.itemId)) ?? [];
        if (list.some((x) => x.vendorId === String(b.vendorId))) continue;
        list.push({ vendorId: String(b.vendorId), vendorName: vendorName.get(String(b.vendorId)) ?? 'Unknown vendor', ratePaise: Math.round(l.amountPaise / (l.qty ?? 1)), date: b.billDate, billNumber: b.billNumber });
        out.set(String(l.itemId), list);
      }
    }
    return out;
  }

  /** Stock on a date: quantity, value at average cost, what to reorder, and purchase prices that moved. */
  async summary(orgId: string, asOf = todayIst()) {
    if (!DATE.test(asOf)) throw new BadRequestException('asOf must look like 2026-11-30');
    const [tracked, moves, ordered, bought] = await Promise.all([this.tracked(orgId), this.moves(orgId, asOf), this.onOrder(orgId), this.lastPurchases(orgId, asOf)]);
    const byItem = new Map(summary(moves, asOf).map((r) => [r.itemId, r]));
    const rows = [...tracked.values()]
      .filter((i) => i.isActive || byItem.has(String(i._id)))
      .map((i) => {
        const id = String(i._id);
        const r = byItem.get(id) ?? { qty: 0, valuePaise: 0, avgPaise: 0, out90: 0, lastInRatePaise: null, prevInRatePaise: null, negative: false };
        const onOrder = ordered.get(id) ?? 0;
        const re = reorder({ qty: r.qty, onOrder, out90: r.out90, reorderLevel: i.reorderLevel ?? null, reorderQty: i.reorderQty ?? null });
        const last = r.lastInRatePaise;
        const prev = r.prevInRatePaise;
        const pct = last != null && prev ? Math.round(((last - prev) / prev) * 1000) / 10 : null;
        return {
          itemId: id,
          name: i.name,
          code: i.code,
          uqc: i.uqc,
          isActive: i.isActive,
          qty: r.qty,
          valuePaise: r.valuePaise,
          avgPaise: r.avgPaise,
          out90: r.out90,
          onOrder,
          negative: r.negative,
          reorderLevel: i.reorderLevel ?? null,
          reorder: re.reorder ? { suggestQty: re.suggestQty, daysLeft: re.daysLeft, reason: re.reason, vendors: bought.get(id) ?? [] } : null,
          priceChange:
            pct != null && Math.abs(pct) >= PRICE_ALERT_PCT
              ? { pct, lastPaise: last!, prevPaise: prev!, reason: `Last bought at ${rupees(last!)} a unit against ${rupees(prev!)} before: ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%.` }
              : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      asOf,
      rows,
      totals: {
        valuePaise: rows.reduce((s, r) => s + r.valuePaise, 0),
        inStock: rows.filter((r) => r.qty > 0).length,
        negative: rows.filter((r) => r.negative).length,
        reorder: rows.filter((r) => r.reorder).length,
        priceChanges: rows.filter((r) => r.priceChange).length,
      },
    };
  }

  /** One item's moves between two dates, with what it held before and after. */
  async ledger(orgId: string, itemId: string, from: string, to: string) {
    if (!DATE.test(from ?? '') || !DATE.test(to ?? '') || from > to) throw new BadRequestException('from and to are dates like 2026-04-01, from first.');
    const item = await this.trackedItem(orgId, itemId);
    const rows = itemLedger(await this.moves(orgId, to, itemId));
    const before = rows.filter((r) => r.date < from);
    const last = before[before.length - 1];
    const opening = last ? { qty: last.balanceQty, valuePaise: last.balanceValuePaise } : { qty: 0, valuePaise: 0 };
    const within = rows.filter((r) => r.date >= from);
    const end = within[within.length - 1];
    return {
      item: { id: itemId, name: item.name, uqc: item.uqc },
      from,
      to,
      opening,
      rows: within.map((r) => ({ date: r.date, qty: r.qty, ratePaise: r.ratePaise, valuePaise: r.valuePaise, balanceQty: r.balanceQty, balanceValuePaise: r.balanceValuePaise, avgPaise: r.avgPaise, source: r.source, note: r.note ?? null })),
      closing: end ? { qty: end.balanceQty, valuePaise: end.balanceValuePaise } : opening,
    };
  }

  /** An item's quantity and its last cost on a date, for adjustments. */
  private async heldOn(orgId: string, itemId: string, date: string) {
    const rows = itemLedger(await this.moves(orgId, date, itemId));
    const end = rows[rows.length - 1];
    const lastIn = [...rows].reverse().find((r) => r.qty > 0 && r.ratePaise != null);
    return { qty: end?.balanceQty ?? 0, avgPaise: end?.avgPaise ?? 0, lastRatePaise: lastIn?.ratePaise ?? null };
  }

  /** Stock moves change what a closed period held; a locked one stays as it was. */
  private async assertOpen(orgId: string, date: string) {
    const lock = await this.lockModel?.findOne({ orgId }).lean().exec();
    if (lock?.lockedThrough && date <= lock.lockedThrough) {
      throw new BadRequestException(`The books are locked through ${lock.lockedThrough}: date the stock change after it, or unlock the period first.`);
    }
  }

  // ── Opening stock and adjustments ─────────────────────────────────────

  /** What an item held when the books began. Entering it again replaces the last one, which stays voided. */
  async setOpening(orgId: string, actorId: string, input: { itemId: string; qty: number; ratePaise: number; date: string }) {
    const item = await this.trackedItem(orgId, input.itemId);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-04-01');
    if (!(input.qty > 0) || !threeDecimals(input.qty)) throw new BadRequestException('Opening quantity is more than nothing, to three decimals at most.');
    if (!Number.isInteger(input.ratePaise) || input.ratePaise < 0) throw new BadRequestException('The rate is a whole number of paise, not negative.');
    await this.assertOpen(orgId, input.date);
    const session = await this.moveModel.db.startSession();
    try {
      let created: StockMoveDocument | undefined;
      await session.withTransaction(async () => {
        const prev = await this.moveModel
          .findOneAndUpdate({ orgId, itemId: item._id, kind: 'opening', voidedAt: null }, { $set: { voidedAt: new Date(), voidedBy: actorId } }, { session })
          .lean()
          .exec();
        if (prev) await this.assertOpen(orgId, prev.date);
        [created] = await this.moveModel.create([{ orgId, itemId: item._id, kind: 'opening', reason: 'opening', date: input.date, qty: round3(input.qty), ratePaise: input.ratePaise, createdBy: actorId }], { session });
        await this.audit.record(
          {
            orgId, entityType: 'StockMove', entityId: created._id.toString(), action: prev ? 'REPLACE_OPENING_STOCK' : 'OPENING_STOCK', performedBy: actorId,
            before: prev ? { id: String(prev._id), qty: prev.qty, ratePaise: prev.ratePaise, date: prev.date } : null,
            after: { item: item.name, qty: created.qty, ratePaise: created.ratePaise, date: created.date },
          },
          session,
        );
      });
      return created!;
    } finally {
      await session.endSession();
    }
  }

  /**
   * A change no document explains. Give the quantity in or out, or what was
   * counted (the difference is worked out). Stock in takes the rate given, or
   * the running average, or the last cost when there is none on hand.
   */
  async adjust(
    orgId: string,
    actorId: string,
    input: { itemId: string; date: string; reason: Exclude<MoveReason, 'opening'>; qty?: number | null; countedQty?: number | null; ratePaise?: number | null; ref?: string | null; note?: string | null },
  ) {
    const item = await this.trackedItem(orgId, input.itemId);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-30');
    if (input.reason === ('opening' as MoveReason)) throw new BadRequestException('Opening stock is entered as opening stock, not an adjustment.');
    await this.assertOpen(orgId, input.date);
    const held = await this.heldOn(orgId, input.itemId, input.date);

    let qty: number;
    if (input.countedQty != null) {
      if (!(input.countedQty >= 0) || !threeDecimals(input.countedQty)) throw new BadRequestException('The count is not negative, to three decimals at most.');
      qty = round3(input.countedQty - held.qty);
      if (qty === 0) throw new BadRequestException(`The count matches the books: ${held.qty} on ${input.date}.`);
    } else {
      qty = round3(Number(input.qty));
      if (!qty || !threeDecimals(Number(input.qty))) throw new BadRequestException('Give the quantity in (+) or out (−), to three decimals at most.');
      if (qty < 0 && held.qty + qty < 0) throw new BadRequestException(`Only ${held.qty} on hand on ${input.date}: ${-qty} cannot go out.`);
    }

    let ratePaise: number | null = null;
    if (qty > 0) {
      if (input.ratePaise != null) {
        if (!Number.isInteger(input.ratePaise) || input.ratePaise < 0) throw new BadRequestException('The rate is a whole number of paise, not negative.');
        ratePaise = input.ratePaise;
      } else if (held.qty <= 0) {
        // No stock to average from: the last cost, or the item's purchase price.
        ratePaise = held.lastRatePaise ?? item.purchasePricePaise ?? null;
        if (ratePaise == null) throw new BadRequestException(`There is no ${item.name} on hand to take an average cost from: give a rate.`);
      }
    }

    const move = await this.moveModel.create({
      orgId, itemId: item._id, kind: 'adjustment', reason: input.reason, date: input.date, qty, ratePaise,
      ref: input.ref?.trim() || null, note: input.note?.trim() || null, createdBy: actorId,
    });
    await this.audit.record({
      orgId, entityType: 'StockMove', entityId: move._id.toString(), action: 'STOCK_ADJUST', performedBy: actorId,
      before: { qty: held.qty },
      after: { item: item.name, reason: input.reason, qty, ratePaise, date: input.date, counted: input.countedQty ?? null, ref: move.ref },
    });
    return move;
  }

  /** Opening stock and adjustments, newest first, voided ones marked. */
  async listMoves(orgId: string, itemId?: string): Promise<Array<Record<string, unknown>>> {
    const moves = await this.moveModel
      .find({ orgId, ...(itemId && Types.ObjectId.isValid(itemId) ? { itemId: new Types.ObjectId(itemId) } : {}) })
      .sort({ date: -1, createdAt: -1 })
      .limit(500)
      .lean()
      .exec();
    const items = await this.itemModel.find({ orgId, _id: { $in: [...new Set(moves.map((m) => String(m.itemId)))] } }, { name: 1, uqc: 1 }).lean().exec();
    const byId = new Map(items.map((i) => [String(i._id), i]));
    return moves.map((m) => ({
      id: String(m._id), itemId: String(m.itemId), itemName: byId.get(String(m.itemId))?.name ?? 'Unknown item', uqc: byId.get(String(m.itemId))?.uqc ?? null,
      kind: m.kind, reason: m.reason, reasonLabel: REASON_LABEL[m.reason], date: m.date, qty: m.qty, ratePaise: m.ratePaise, ref: m.ref, note: m.note,
      voided: !!m.voidedAt,
    }));
  }

  /** A stored move entered by mistake: voided, kept, and audited. */
  async voidMove(orgId: string, actorId: string, id: string) {
    const move = Types.ObjectId.isValid(id) ? await this.moveModel.findOne({ _id: id, orgId }).exec() : null;
    if (!move) throw new NotFoundException('No such stock move.');
    if (move.voidedAt) throw new ConflictException('This move is already voided.');
    await this.assertOpen(orgId, move.date);
    move.voidedAt = new Date();
    move.voidedBy = actorId;
    await move.save();
    await this.audit.record({
      orgId, entityType: 'StockMove', entityId: id, action: 'VOID', performedBy: actorId,
      before: { kind: move.kind, reason: move.reason, qty: move.qty, ratePaise: move.ratePaise, date: move.date }, after: { voided: true },
    });
    return { voided: true };
  }

  // ── Linking lines to items ────────────────────────────────────────────

  private doc(kind: DocKind) {
    return kind === 'bill'
      ? { model: this.billModel as unknown as Model<PurchaseBillDocument | SalesInvoiceDocument>, statuses: DONE_BILL as string[], date: 'billDate', number: 'billNumber', party: 'vendorId', entity: 'PurchaseBill' }
      : { model: this.invoiceModel as unknown as Model<PurchaseBillDocument | SalesInvoiceDocument>, statuses: DONE_INVOICE as string[], date: 'invoiceDate', number: 'invoiceNumber', party: 'customerId', entity: 'SalesInvoice' };
  }

  /**
   * Posted lines not linked to an item, each with a suggestion: what this
   * party's same line was linked to, the item whose name it shares, or a
   * new item. Services (SAC 99…) and lines marked not stock are left out.
   */
  async unlinkedLines(orgId: string, kind: DocKind = 'bill', limit = 200) {
    const d = this.doc(kind);
    type Row = { _id: Types.ObjectId; lineItems: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; taxRatePct: number; itemId: Types.ObjectId | null; notStock?: boolean }> } & Record<string, unknown>;
    const [docs, linkedDocs, items] = await Promise.all([
      d.model
        .find({ orgId, status: { $in: d.statuses }, isOpeningBalance: { $ne: true }, lineItems: { $elemMatch: { itemId: null, notStock: { $ne: true }, hsnSac: { $not: /^\s*99/ } } } })
        .sort({ [d.date]: -1, _id: -1 })
        .limit(300)
        .lean<Row[]>()
        .exec(),
      d.model
        .find({ orgId, lineItems: { $elemMatch: { itemId: { $ne: null } } } }, { [d.party]: 1, [d.number]: 1, [d.date]: 1, lineItems: 1 })
        .sort({ [d.date]: 1, _id: 1 })
        .limit(2000)
        .lean<Row[]>()
        .exec(),
      this.itemModel.find({ orgId, isActive: true }, { name: 1, kind: 1, hsnSac: 1 }).lean().exec(),
    ]);
    const mappingItems: MappingItem[] = items.map((i) => ({ id: String(i._id), name: i.name, kind: i.kind, hsnSac: i.hsnSac }));
    const linked: LinkedLine[] = linkedDocs.flatMap((doc) =>
      doc.lineItems.filter((l) => l.itemId).map((l) => ({ partyId: String(doc[d.party]), description: l.description, itemId: String(l.itemId), docNumber: (doc[d.number] as string | null) ?? null })),
    );
    const partyIds = [...new Set(docs.map((doc) => String(doc[d.party])))];
    const parties = kind === 'bill'
      ? await this.vendorModel.find({ orgId, _id: { $in: partyIds } }, { name: 1 }).lean().exec()
      : await this.customerModel.find({ orgId, _id: { $in: partyIds } }, { name: 1 }).lean().exec();
    const partyName = new Map(parties.map((p) => [String(p._id), p.name]));

    const out: Array<{ docKind: DocKind; docId: string; number: string | null; date: string; partyName: string; line: number; description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; suggestion: Suggestion }> = [];
    for (const doc of docs) {
      doc.lineItems.forEach((l, i) => {
        if (out.length >= limit || l.itemId || l.notStock || isServiceLine(l.hsnSac)) return;
        out.push({
          docKind: kind, docId: String(doc._id), number: (doc[d.number] as string | null) ?? null, date: doc[d.date] as string, partyName: partyName.get(String(doc[d.party])) ?? 'Unknown',
          line: i, description: l.description, hsnSac: l.hsnSac, qty: l.qty ?? 1, ratePaise: l.ratePaise, amountPaise: l.amountPaise,
          suggestion: suggestItem({ partyId: String(doc[d.party]), description: l.description, hsnSac: l.hsnSac, taxRatePct: l.taxRatePct ?? 0 }, mappingItems, linked, kind === 'bill' ? 'vendor' : 'customer'),
        });
      });
    }
    return out;
  }

  /**
   * Link one line to an item, a new one made from the line, or mark it not
   * stock. Only the link changes; amounts and the posted journal never do.
   */
  async linkLine(orgId: string, actorId: string, input: LinkInput, by: 'person' | 'vendor_history' = 'person') {
    const d = this.doc(input.docKind);
    if (!Types.ObjectId.isValid(input.docId)) throw new NotFoundException('No such document.');
    const doc = await d.model.findOne({ _id: input.docId, orgId }).lean().exec();
    if (!doc) throw new NotFoundException('No such document.');
    const n = input.line;
    const line = Number.isInteger(n) && n >= 0 ? doc.lineItems[n] : undefined;
    if (!line) throw new NotFoundException('No such line on this document.');

    let item: ItemDocument | null = null;
    if (input.notStock) {
      // Marked not stock: no item.
    } else if (input.newItem) {
      const qty = line.qty || 1;
      const uqc = input.newItem.uqc && (UQC_CODES as readonly string[]).includes(input.newItem.uqc) ? input.newItem.uqc : 'NOS';
      item = await this.items.create(orgId, actorId, {
        name: input.newItem.name, kind: 'goods', hsnSac: input.newItem.hsnSac ?? line.hsnSac ?? null, uqc, gstRatePct: input.newItem.gstRatePct ?? null,
        ...(input.docKind === 'bill' ? { purchasePricePaise: Math.round(line.amountPaise / qty) } : { salePricePaise: Math.round(line.amountPaise / qty) }),
      });
    } else if (input.itemId) {
      item = await this.items.findById(orgId, input.itemId);
    } else {
      throw new BadRequestException('Pick an item, create one, or mark the line not stock.');
    }

    const set: Record<string, unknown> = { [`lineItems.${n}.itemId`]: item?._id ?? null, [`lineItems.${n}.notStock`]: !!input.notStock };
    // A bill's unit is not in any return; an invoice's is in GSTR-1, so a filed one keeps its own.
    if (input.docKind === 'bill' && item && !line.uqc) set[`lineItems.${n}.uqc`] = item.uqc;
    const res = await d.model.updateOne({ _id: doc._id, orgId, [`lineItems.${n}.description`]: line.description }, { $set: set }).exec();
    if (!res.matchedCount) throw new ConflictException('The document changed meanwhile: reload and try again.');
    await this.audit.record({
      orgId, entityType: d.entity, entityId: String(doc._id), action: input.notStock ? 'MARK_NOT_STOCK' : 'LINK_ITEM', performedBy: actorId,
      before: { line: n, itemId: line.itemId ? String(line.itemId) : null, notStock: !!(line as { notStock?: boolean }).notStock },
      after: { line: n, itemId: item ? String(item._id) : null, item: item?.name ?? null, notStock: !!input.notStock, by, created: !!input.newItem },
    });
    return { itemId: item ? String(item._id) : null, itemName: item?.name ?? null, notStock: !!input.notStock };
  }

  /** Every line this party's same line was linked before: a person presses one button for all of them. */
  async linkFromHistory(orgId: string, actorId: string, kind: DocKind = 'bill') {
    const lines = await this.unlinkedLines(orgId, kind, 500);
    let linked = 0;
    for (const l of lines) {
      if (l.suggestion.by !== 'vendor_history') continue;
      await this.linkLine(orgId, actorId, { docKind: kind, docId: l.docId, line: l.line, itemId: l.suggestion.itemId }, 'vendor_history');
      linked++;
    }
    return { linked };
  }

  // ── Reorders ──────────────────────────────────────────────────────────

  /**
   * A draft purchase order for what is short, at this vendor's last rate (or
   * the item's purchase price). A PO posts nothing; it is sent when a person
   * sends it.
   */
  async orderReorders(orgId: string, actorId: string, input: { vendorId: string; lines: Array<{ itemId: string; qty: number }> }) {
    if (!this.purchaseDocs) throw new BadRequestException('Purchase orders are not set up here.');
    if (!input.lines?.length) throw new BadRequestException('Pick at least one item to order.');
    const [tracked, bought] = await Promise.all([this.tracked(orgId), this.lastPurchases(orgId, todayIst())]);
    const lines = input.lines.map((l) => {
      const item = tracked.get(l.itemId);
      if (!item) throw new BadRequestException('Only stock items can be reordered.');
      if (!(l.qty > 0) || !threeDecimals(l.qty)) throw new BadRequestException(`Order more than nothing of ${item.name}, to three decimals at most.`);
      const history = bought.get(l.itemId) ?? [];
      const rate = history.find((h) => h.vendorId === input.vendorId)?.ratePaise ?? item.purchasePricePaise ?? history[0]?.ratePaise ?? null;
      if (!rate) throw new BadRequestException(`No rate for ${item.name}: enter a purchase price on the item first.`);
      return { description: item.name, itemId: l.itemId, hsnSac: item.hsnSac, uqc: item.uqc, qty: round3(l.qty), ratePaise: rate, taxRatePct: item.gstRatePct ?? 0 };
    });
    return this.purchaseDocs.createPo(orgId, actorId, { vendorId: input.vendorId, lines, notes: 'Reorder from stock levels' });
  }

  // ── The opening and closing stock entries ─────────────────────────────

  /** Net debit on an account from posted journals to a date. */
  private async booksOn(orgId: string, accountId: Types.ObjectId, to: string): Promise<number> {
    const [row] = await this.journalModel
      .aggregate<{ net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED, date: { $lte: to }, 'lines.accountId': accountId } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': accountId } },
        { $group: { _id: null, net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } } } },
      ])
      .exec();
    return row?.net ?? 0;
  }

  /** In review for this kind (and period), and how many were approved: the next one's key. */
  private async drafted(orgId: string, kind: AdjustmentKind, period: string) {
    const live = (await this.adjustments.live(orgId, kind)).filter((p) => p.adjustment?.period === period);
    return { inReview: live.find((p) => p.status === ProposedEntryStatus.PROPOSED) ?? null, approved: live.filter((p) => p.status === ProposedEntryStatus.APPROVED).length };
  }

  /**
   * Opening stock on the items against Stock in Hand on the books at the
   * opening date. A trial balance brought in with its stock already matches;
   * otherwise the difference is an opening entry, so the first closing
   * entry does not count stock the business always had as profit.
   */
  async opening(orgId: string) {
    const moves = await this.moveModel.find({ orgId, kind: 'opening', voidedAt: null }).lean().exec();
    if (!moves.length) return { date: null, itemsPaise: 0, booksPaise: 0, differencePaise: 0, inReview: false };
    const date = moves.map((m) => m.date).sort().reverse()[0];
    const inventory = await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.INVENTORY);
    const itemsPaise = moves.reduce((s, m) => s + Math.round(m.qty * (m.ratePaise ?? 0)), 0);
    const booksPaise = await this.booksOn(orgId, inventory._id, date);
    const { inReview } = await this.drafted(orgId, 'opening_stock', date);
    return { date, itemsPaise, booksPaise, differencePaise: itemsPaise - booksPaise, inReview: !!inReview };
  }

  async proposeOpening(orgId: string, actorId: string) {
    const o = await this.opening(orgId);
    if (!o.date) throw new BadRequestException('Enter opening stock on the items first.');
    if (o.inReview) throw new ConflictException('An opening stock entry is waiting in the review queue: approve or reject it first.');
    if (o.differencePaise === 0) throw new ConflictException('The books already carry the opening stock.');
    if (o.differencePaise < 0) {
      throw new BadRequestException(`The books show ${rupees(o.booksPaise)} of stock on ${o.date}, more than the ${rupees(o.itemsPaise)} entered on the items: enter the rest of the opening stock.`);
    }
    const map = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.INVENTORY, SystemAccountKey.RETAINED_EARNINGS]);
    const inventory = map.get(SystemAccountKey.INVENTORY)!;
    const reserves = map.get(SystemAccountKey.RETAINED_EARNINGS)!;
    const { approved } = await this.drafted(orgId, 'opening_stock', o.date);
    return this.adjustments.propose({
      orgId, actorId, kind: 'opening_stock', refId: `stock-${approved + 1}`, period: o.date, date: o.date, unique: true,
      narration: `Opening stock as at ${o.date}`,
      reason: `Opening stock on the items is ${rupees(o.itemsPaise)}; the books carry ${rupees(o.booksPaise)} on ${o.date}. The ${rupees(o.differencePaise)} goes to ${inventory.name} against ${reserves.name}, as stock held before the books began.`,
      lines: [
        { accountId: String(inventory._id), debitPaise: o.differencePaise, creditPaise: 0 },
        { accountId: String(reserves._id), debitPaise: 0, creditPaise: o.differencePaise },
      ],
    });
  }

  /** Stock at a month's end against Stock in Hand on the books, and what would stop the entry. */
  async closing(orgId: string, period: string) {
    if (!PERIOD.test(period ?? '')) throw new BadRequestException('period is a month like 2026-11.');
    const date = periodEnd(period);
    const inventory = await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.INVENTORY);
    const [stock, booksPaise, opening, drafted] = await Promise.all([this.summary(orgId, date), this.booksOn(orgId, inventory._id, date), this.opening(orgId), this.drafted(orgId, 'closing_stock', period)]);
    const stockPaise = stock.totals.valuePaise;
    const blockers: string[] = [];
    if (opening.differencePaise !== 0 && opening.date && opening.date <= date) {
      blockers.push(opening.inReview ? 'The opening stock entry is waiting in the review queue: approve it first.' : `The books do not carry the opening stock yet (${rupees(opening.differencePaise)} short on ${opening.date}): propose the opening stock entry first.`);
    }
    if (drafted.inReview) blockers.push(`A closing stock entry for ${period} is waiting in the review queue: approve or reject it first.`);
    return {
      period,
      date,
      stockPaise,
      booksPaise,
      differencePaise: stockPaise - booksPaise,
      items: stock.rows.filter((r) => r.qty !== 0).map((r) => ({ itemId: r.itemId, name: r.name, qty: r.qty, uqc: r.uqc, valuePaise: r.valuePaise, avgPaise: r.avgPaise })),
      negative: stock.rows.filter((r) => r.negative).map((r) => ({ itemId: r.itemId, name: r.name, qty: r.qty })),
      blockers,
      inReview: !!drafted.inReview,
    };
  }

  /**
   * The closing-stock entry for a month, to the review queue: the change
   * between stock at cost and what the books carry, so each month books
   * only its own movement. Nothing posts until a person approves.
   */
  async proposeClosing(orgId: string, actorId: string, period: string) {
    const c = await this.closing(orgId, period);
    if (c.blockers.length) throw new ConflictException(c.blockers[0]);
    if (c.differencePaise === 0) throw new ConflictException(`The books already carry the stock at ${period}'s end: ${rupees(c.stockPaise)}.`);
    const map = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.INVENTORY, SystemAccountKey.CHANGE_IN_INVENTORY]);
    const inventory = map.get(SystemAccountKey.INVENTORY)!;
    const change = map.get(SystemAccountKey.CHANGE_IN_INVENTORY)!;
    const up = c.differencePaise > 0;
    const amount = Math.abs(c.differencePaise);
    const negatives = c.negative.length ? ` ${c.negative.length} item${c.negative.length === 1 ? ' is' : 's are'} below nothing (${c.negative.slice(0, 3).map((n) => n.name).join(', ')}) and counted at nil: a bill may be missing or a line unlinked.` : '';
    const { approved } = await this.drafted(orgId, 'closing_stock', period);
    return this.adjustments.propose({
      orgId, actorId, kind: 'closing_stock', refId: `stock-${approved + 1}`, period, date: c.date, unique: true,
      narration: `Closing stock as at ${c.date}`,
      reason:
        `Stock on hand at ${c.date} is ${rupees(c.stockPaise)} at weighted-average cost across ${c.items.filter((i) => i.qty > 0).length} item${c.items.filter((i) => i.qty > 0).length === 1 ? '' : 's'}; ` +
        `${inventory.name} carries ${rupees(c.booksPaise)}. The ${up ? 'increase' : 'decrease'} of ${rupees(amount)} is booked against ${change.name}.${negatives}`,
      lines: up
        ? [
            { accountId: String(inventory._id), debitPaise: amount, creditPaise: 0 },
            { accountId: String(change._id), debitPaise: 0, creditPaise: amount },
          ]
        : [
            { accountId: String(change._id), debitPaise: amount, creditPaise: 0 },
            { accountId: String(inventory._id), debitPaise: 0, creditPaise: amount },
          ],
    });
  }
}
