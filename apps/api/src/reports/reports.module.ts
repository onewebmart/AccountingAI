import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { GlModule } from '../gl/gl.module';
import { MailModule } from '../mail/mail.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Budget, BudgetSchema } from './schemas/budget.schema';
import { ReportSchedule, ReportScheduleSchema } from './schemas/report-schedule.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ManagementReportsService } from './management.service';
import { ReportCatalogService } from './report-catalog.service';
import { ReportSchedulesService } from './report-schedules.service';
import { ManagementController } from './management.controller';

/** The books' reports, management reports and budgets, PDFs and CSVs of any of them, and scheduled report emails. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: LedgerAccount.name, schema: LedgerAccountSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Item.name, schema: ItemSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: ReportSchedule.name, schema: ReportScheduleSchema },
    ]),
    GlModule, // AuditService
    MailModule, // scheduled reports go out by email
  ],
  controllers: [ReportsController, ManagementController],
  providers: [ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService],
  exports: [ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService],
})
export class ReportsModule {}
