import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type LedgerAccountDocument = HydratedDocument<LedgerAccount>;

/**
 * Stable identifiers for the accounts the automation layer must resolve by meaning
 * rather than by name. The AI proposal builder, bank reconciliation and GST posting
 * all look accounts up through these keys, so renaming an account in the UI never
 * breaks posting.
 */
export enum SystemAccountKey {
  PURCHASE_EXPENSE = 'PURCHASE_EXPENSE',
  ACCOUNTS_PAYABLE = 'ACCOUNTS_PAYABLE',
  ACCOUNTS_RECEIVABLE = 'ACCOUNTS_RECEIVABLE',
  SALES_REVENUE = 'SALES_REVENUE',
  GST_INPUT_CGST = 'GST_INPUT_CGST',
  GST_INPUT_SGST = 'GST_INPUT_SGST',
  GST_INPUT_IGST = 'GST_INPUT_IGST',
  GST_INPUT_CESS = 'GST_INPUT_CESS',
  GST_OUTPUT_CGST = 'GST_OUTPUT_CGST',
  GST_OUTPUT_SGST = 'GST_OUTPUT_SGST',
  GST_OUTPUT_IGST = 'GST_OUTPUT_IGST',
  GST_OUTPUT_CESS = 'GST_OUTPUT_CESS',
  BANK = 'BANK',
  CASH = 'CASH',
  ROUND_OFF = 'ROUND_OFF',
  SUSPENSE = 'SUSPENSE',
}

@Schema({ timestamps: true, collection: 'ledger_accounts' })
export class LedgerAccount {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, trim: true })
  name: string;

  /** Human-facing account code, unique per org (e.g. "2100"). */
  @Prop({ required: true })
  code: string;

  @Prop({ type: String, enum: Object.values(AccountType), required: true, index: true })
  type: AccountType;

  /** Parent group account; null for a top-level group. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null, index: true })
  parentId?: MongooseSchema.Types.ObjectId | null;

  /** Group accounts are headers — they cannot be posted to directly. */
  @Prop({ default: false })
  isGroup: boolean;

  /** Set on seeded accounts so automation can resolve them by meaning. */
  @Prop({ type: String, enum: Object.values(SystemAccountKey), index: true, sparse: true })
  systemKey?: SystemAccountKey;

  /** Seeded accounts cannot be deleted — posting depends on them. */
  @Prop({ default: false })
  isSystem: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

export const LedgerAccountSchema = SchemaFactory.createForClass(LedgerAccount);

LedgerAccountSchema.index({ orgId: 1, code: 1 }, { unique: true });
LedgerAccountSchema.index({ orgId: 1, systemKey: 1 });
LedgerAccountSchema.index({ orgId: 1, type: 1, name: 1 });

LedgerAccountSchema.plugin(tenantIsolationPlugin);
