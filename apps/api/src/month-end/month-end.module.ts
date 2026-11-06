import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { FixedAsset, FixedAssetSchema } from './schemas/fixed-asset.schema';
import { AdjustmentSchedule, AdjustmentScheduleSchema } from './schemas/adjustment-schedule.schema';
import { AdjustmentsService } from './adjustments.service';
import { SchedulesService } from './schedules.service';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import { MonthEndSweepService } from './month-end-sweep.service';
import { MonthEndController } from './month-end.controller';
import { BulkUpdateService } from './bulk-update.service';
import { VoucherContactsService } from './voucher-contacts.service';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';

/** Recurring journals' drafting, accruals and prepaids, the asset register, and the month-end assistant. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FixedAsset.name, schema: FixedAssetSchema },
      { name: AdjustmentSchedule.name, schema: AdjustmentScheduleSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Item.name, schema: ItemSchema }, // read only: stock lines are not assets to capitalise
      // Read only, for bulk update: who each voucher was with, from the document that posted it.
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      { name: PartyPayment.name, schema: PartyPaymentSchema },
      { name: DirectExpense.name, schema: DirectExpenseSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService, the chart and journals
  ],
  controllers: [MonthEndController],
  providers: [AdjustmentsService, SchedulesService, AssetsService, AssistantService, MonthEndSweepService, BulkUpdateService, VoucherContactsService],
  exports: [AdjustmentsService, MonthEndSweepService, AssetsService],
})
export class MonthEndModule {}
