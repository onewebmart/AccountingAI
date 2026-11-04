import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PartyAsIssued } from '../../gl/party-as-issued';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import {
  Adjustment,
  AdjustmentSchema,
  Settlement,
  SettlementSchema,
  settledAmountProp,
} from '../../gl/schemas/settlement.schema';

export type PurchaseBillDocument = HydratedDocument<PurchaseBill>;

@Schema({ _id: false })
class BillAmounts {
  @Prop({ type: Number, required: true }) taxableValue: number;
  @Prop({ type: Number, required: true }) cgst: number;
  @Prop({ type: Number, required: true }) sgst: number;
  @Prop({ type: Number, required: true }) igst: number;
  @Prop({ type: Number, required: true }) cess: number;
  @Prop({ type: Number, required: true }) total: number;
}

@Schema({ _id: false })
class BillLineItem {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, default: 1 }) qty: number;
  @Prop({ type: Number, required: true }) ratePaise: number;
  @Prop({ type: Number, required: true }) amountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
  /** The item picked for this line, if any. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) itemId: Types.ObjectId | null;
  /** GST unit (UQC) for the HSN summary; from the item when one is picked. */
  @Prop({ type: String, default: null }) uqc: string | null;
  /** Where this line's value posts, from the item; the default account when null. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) accountId: Types.ObjectId | null;
  /** Marked by a person as not a stock item (packing, a one-off), so it stops asking to be linked. */
  @Prop({ type: Boolean, default: false }) notStock: boolean;
  /** The project this line's income or cost belongs to; its journal line carries it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null }) projectId: Types.ObjectId | null;
}

/** TDS deducted from this bill — booked when the bill is, as the law expects. */
@Schema({ _id: false })
export class BillTds {
  @Prop({ type: String, required: true }) section: string;
  /** Basis points: 100 = 1%. */
  @Prop({ type: Number, required: true }) rateBps: number;
  /** Integer paise withheld from the vendor and owed to the government. */
  @Prop({ type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'TDS must be integer paise' } })
  amountPaise: number;
  /** The TDS deposit (challan) that paid it over, once one has. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TdsDeposit', default: null })
  depositId: Types.ObjectId | null;
}
const BillTdsSchema = SchemaFactory.createForClass(BillTds);

@Schema({ collection: 'purchase_bills', timestamps: true })
export class PurchaseBill {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Vendor', index: true })
  vendorId: Types.ObjectId;

  /** Human-readable bill reference number (from vendor). */
  @Prop({ type: String, default: null }) billNumber: string | null;
  /** Date of the bill (YYYY-MM-DD). */
  @Prop({ type: String, required: true }) billDate: string;
  /** Payment due date (YYYY-MM-DD). */
  @Prop({ type: String, default: null }) dueDate: string | null;

  @Prop({
    type: String,
    enum: Object.values(BillStatus),
    default: BillStatus.DRAFT,
    index: true,
  })
  status: BillStatus;

  @Prop({ type: BillAmounts, required: true }) amountsPaise: BillAmounts;
  @Prop({ type: [BillLineItem], default: [] }) lineItems: BillLineItem[];

  /** Financial year computed at post time (e.g. "2025-26"). */
  @Prop({ type: String, default: null }) financialYear: string | null;

  /** Set after PostingService.post() succeeds. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  /**
   * Integer paise paid so far, across every payment in `payments`. The
   * document stays posted until this reaches the total, then becomes paid.
   */
  @Prop(settledAmountProp) amountPaidPaise: number;

  /** Each payment against this document — part payments add one each. */
  @Prop({ type: [SettlementSchema], default: [] }) payments: Settlement[];

  /** TDS withheld from the vendor, if their section applies. */
  @Prop({ type: BillTdsSchema, default: null }) tds: BillTds | null;

  /** Billed against a purchase order: which, and how much of each of its lines. */
  @Prop({ type: Object, default: null })
  source: { kind: 'purchase_order'; id: string; lines: Array<{ poLine: number; qty: number }> } | null;

  /**
   * GST on this purchase is ours to pay the government (reverse charge): the
   * vendor is owed the taxable value only, and the tax is booked as a liability
   * with input credit taken alongside.
   */
  @Prop({ type: Boolean, default: false }) isReverseCharge: boolean;

  /** Reduced by debit notes, in integer paise — counted against what is owed. */
  @Prop(settledAmountProp) adjustedPaise: number;

  /** Each debit note against this document. */
  @Prop({ type: [AdjustmentSchema], default: [] }) adjustments: Adjustment[];

  /** Actor who posted this bill to the ledger. */
  @Prop({ type: String, default: null }) postedBy: string | null;
  /** Who entered it; under an approval policy they cannot approve it. Null for bills made by the system. */
  @Prop({ type: String, default: null }) createdBy: string | null;
  /** Actor who marked this bill as paid. */
  @Prop({ type: String, default: null }) paidBy: string | null;
  @Prop({ type: String, default: null }) notes: string | null;

  /**
   * The uploaded document this came from, when it came from one.
   *
   * Null for a manual entry. Lets Purchase and Sales show which rows were read
   * off a scan and link back to the file, rather than the two kinds of entry
   * being indistinguishable once posted.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document', default: null, index: true })
  sourceDocumentId?: MongooseSchema.Types.ObjectId | null;

  /** The recurring template that drafted this, when one did. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'RecurringTemplate', default: null })
  recurringTemplateId?: MongooseSchema.Types.ObjectId | null;

  /**
   * An opening balance brought in from another system: what the party owed
   * on the day the books moved here. It has no posting of its own (the
   * opening journal carries it) and is not a supply, so GST returns skip it.
   */
  @Prop({ type: Boolean, default: false }) isOpeningBalance: boolean;

  /**
   * The party as it stood when this was issued, stamped before the party's
   * name, GSTIN or state is edited. Null: read the party as it is now.
   */
  @Prop({ type: Object, default: null }) partyAtIssue: PartyAsIssued | null;

}

export const PurchaseBillSchema = SchemaFactory.createForClass(PurchaseBill);
PurchaseBillSchema.index({ orgId: 1, vendorId: 1, status: 1 });
PurchaseBillSchema.plugin(tenantIsolationPlugin);
