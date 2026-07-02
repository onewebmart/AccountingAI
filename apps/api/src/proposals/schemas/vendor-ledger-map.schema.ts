import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VendorLedgerMapDocument = HydratedDocument<VendorLedgerMap>;

@Schema({ collection: 'vendor_ledger_maps', timestamps: true })
export class VendorLedgerMap {
  /** Tenant-scoped — always filtered by orgId. */
  @Prop({ required: true, index: true })
  orgId: string;

  /** Normalized vendor name (lowercase, trimmed, whitespace-collapsed). */
  @Prop({ required: true })
  vendor: string;

  /** Real CoA account ObjectId string from a human-confirmed posting. */
  @Prop({ required: true })
  ledgerAccountId: string;

  @Prop({ required: true })
  accountName: string;

  /** Number of times a human has confirmed this mapping. */
  @Prop({ type: Number, default: 1 })
  count: number;

  /** Accumulated weight — incremented by 1 on each human confirmation. */
  @Prop({ type: Number, default: 1 })
  strength: number;
}

export const VendorLedgerMapSchema = SchemaFactory.createForClass(VendorLedgerMap);
VendorLedgerMapSchema.index({ orgId: 1, vendor: 1 }, { unique: true });
