import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { ACCOUNT_SUBTYPE_KEYS, type AccountSubtype } from '../account-subtypes';

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
  /** Tax we deducted from a vendor and owe the government. */
  TDS_PAYABLE = 'TDS_PAYABLE',
  /** Tax a customer deducted from what they paid us — claimable against our own tax. */
  TDS_RECEIVABLE = 'TDS_RECEIVABLE',
  /** GST we owe on purchases under reverse charge. */
  RCM_GST_PAYABLE = 'RCM_GST_PAYABLE',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  /** Money received from customers before the invoice it pays (a liability). */
  CUSTOMER_ADVANCES = 'CUSTOMER_ADVANCES',
  /** Money paid to vendors before the bill it pays (an asset). */
  VENDOR_ADVANCES = 'VENDOR_ADVANCES',
  /** Paid online, held by the payment gateway until it settles to the bank, less its fee. */
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
  PREPAID_EXPENSES = 'PREPAID_EXPENSES',
  ACCRUED_EXPENSES = 'ACCRUED_EXPENSES',
  ACCUMULATED_DEPRECIATION = 'ACCUMULATED_DEPRECIATION',
  DEPRECIATION = 'DEPRECIATION',
  ASSET_DISPOSAL_GAIN = 'ASSET_DISPOSAL_GAIN',
  ASSET_DISPOSAL_LOSS = 'ASSET_DISPOSAL_LOSS',
  EMPLOYEE_PAYABLE = 'EMPLOYEE_PAYABLE',
  /** Goods on hand at cost, booked at each period end (periodic inventory). */
  INVENTORY = 'INVENTORY',
  /** The P&L side of the closing-stock entry: opening less closing stock. */
  CHANGE_IN_INVENTORY = 'CHANGE_IN_INVENTORY',
  /** Gain on foreign-currency documents: paid at a better rate than booked, or revalued up. */
  FX_GAIN = 'FX_GAIN',
  FX_LOSS = 'FX_LOSS',
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

  /**
   * The detailed type (Bank, Input Tax, Cost of Goods Sold…), always one of
   * `type`'s: reports keep using `type`. Null on accounts saved before it
   * existed; AccountsService derives it for them (deriveAccountSubtype).
   */
  @Prop({ type: String, enum: [...ACCOUNT_SUBTYPE_KEYS, null], default: null })
  accountType?: AccountSubtype | null;

  @Prop({ type: String, default: '', maxlength: 500 })
  description?: string;

  /** Shown with its balance on the dashboard's watchlist card. */
  @Prop({ type: Boolean, default: false })
  watchlist?: boolean;
}

export const LedgerAccountSchema = SchemaFactory.createForClass(LedgerAccount);

LedgerAccountSchema.index({ orgId: 1, code: 1 }, { unique: true });
LedgerAccountSchema.index({ orgId: 1, systemKey: 1 });
LedgerAccountSchema.index({ orgId: 1, type: 1, name: 1 });

LedgerAccountSchema.plugin(tenantIsolationPlugin);
