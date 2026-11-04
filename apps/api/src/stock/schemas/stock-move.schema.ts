import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type StockMoveDocument = HydratedDocument<StockMove>;

export const MOVE_REASONS = ['opening', 'count', 'damaged', 'customer_return', 'vendor_return', 'own_use', 'other'] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

/**
 * Stock that no bill or invoice explains: what was on hand when the books
 * began, and what a count, a breakage or a return changed. Moves from bills
 * and invoices are not copied here; they are read from the documents, so a
 * reversed document stops counting by itself. Never deleted: a mistake is
 * voided and stays visible.
 */
@Schema({ collection: 'stock_moves', timestamps: true })
export class StockMove {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', required: true, index: true }) itemId: Types.ObjectId;
  @Prop({ type: String, enum: ['opening', 'adjustment'], required: true }) kind: 'opening' | 'adjustment';
  @Prop({ type: String, enum: MOVE_REASONS, required: true }) reason: MoveReason;
  /** YYYY-MM-DD */
  @Prop({ type: String, required: true }) date: string;
  /** + in, − out; up to three decimals. */
  @Prop({
    type: Number,
    required: true,
    validate: { validator: (v: number) => v !== 0 && Number.isFinite(v) && Math.round(v * 1000) === v * 1000, message: 'A quantity is not nothing, to three decimals at most.' },
  })
  qty: number;
  /** Cost per unit for stock in; null takes the running average (a return, a count found more). */
  @Prop({
    type: Number,
    default: null,
    validate: { validator: (v: number | null) => v === null || (Number.isInteger(v) && v >= 0), message: 'A rate is a whole number of paise, not negative.' },
  })
  ratePaise: number | null;
  /** The note, count sheet or reference it came from: "CN/2026-27/0004". */
  @Prop({ type: String, default: null, trim: true }) ref: string | null;
  @Prop({ type: String, default: null, trim: true }) note: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
  @Prop({ type: Date, default: null }) voidedAt: Date | null;
  @Prop({ type: String, default: null }) voidedBy: string | null;
}

export const StockMoveSchema = SchemaFactory.createForClass(StockMove);
StockMoveSchema.index({ orgId: 1, itemId: 1, date: 1 });
// One live opening per item: entering it again voids the last one first.
StockMoveSchema.index({ orgId: 1, itemId: 1 }, { unique: true, partialFilterExpression: { kind: 'opening', voidedAt: { $type: 'null' } } });
StockMoveSchema.plugin(tenantIsolationPlugin);
