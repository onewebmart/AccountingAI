import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { withOrg } from '../database/tenant.plugin';
import { OcrModule } from '../ocr/ocr.module';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { ImportBatch, ImportBatchSchema } from '../migration/schemas/import-batch.schema';
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
import { NamedBudget, NamedBudgetSchema } from './schemas/named-budget.schema';
import { BudgetsService } from './budgets.service';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { TimeEntry, TimeEntrySchema } from '../projects/schemas/time-entry.schema';
import { ReportSchedule, ReportScheduleSchema } from './schemas/report-schedule.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ManagementReportsService } from './management.service';
import { ReportCatalogService } from './report-catalog.service';
import { ReportSchedulesService } from './report-schedules.service';
import { ManagementController } from './management.controller';
import { REPORT_AI_QUEUE, ReportAiService } from './report-ai.service';
import { GeminiReportModel, REPORT_MODEL } from './report-model';
// The Reports Center: its reports (catalog/), favourites and visits, custom reports.
import { CustomReport, CustomReportSchema } from './schemas/custom-report.schema';
import { ReportPreference, ReportPreferenceSchema } from './schemas/report-preference.schema';
import { ReportDataService } from './catalog/report-data.service';
import { ReportCenterService } from './catalog/center.service';
import { ReportCenterController } from './catalog/center.controller';
import { Quote, QuoteSchema, SalesOrder, SalesOrderSchema, DeliveryChallan, DeliveryChallanSchema } from '../orders/schemas/sales-docs.schema';
import { PurchaseOrder, PurchaseOrderSchema } from '../orders/schemas/purchase-docs.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimSchema } from '../expenses/schemas/expense-claim.schema';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { RecurringTemplate, RecurringTemplateSchema } from '../automation/schemas/recurring-template.schema';
import { PaymentReminder, PaymentReminderSchema } from '../automation/schemas/payment-reminder.schema';
import { BankAccount, BankAccountSchema } from '../banking/schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from '../banking/schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { Gstr2bLine, Gstr2bLineSchema } from '../gst/schemas/gstr2b-line.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';

/** The narrative and the questions the model words, one job each, off the request path. */
@Processor(REPORT_AI_QUEUE)
export class ReportAiProcessor extends WorkerHost {
  constructor(private readonly ai: ReportAiService) {
    super();
  }

  async process(job: Job<{ orgId: string; suggestionId: string }>): Promise<void> {
    const { orgId, suggestionId } = job.data;
    await withOrg(orgId, () => (job.name === 'ask' ? this.ai.runAsk(orgId, suggestionId) : this.ai.runNarrative(orgId, suggestionId)));
  }
}

/** The books' reports, management reports and budgets, PDFs and CSVs of any of them, scheduled report emails, the monthly narrative and Ask your books. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema }, // read only: which vouchers were opening balances
      { name: LedgerAccount.name, schema: LedgerAccountSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Item.name, schema: ItemSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: Budget.name, schema: BudgetSchema }, // the old per-year budgets: read once, to copy into named budgets
      { name: NamedBudget.name, schema: NamedBudgetSchema },
      { name: ReportSchedule.name, schema: ReportScheduleSchema },
      { name: AiSuggestion.name, schema: AiSuggestionSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      // The Reports Center: its own two collections, and the documents its reports read (read only).
      { name: CustomReport.name, schema: CustomReportSchema },
      { name: ReportPreference.name, schema: ReportPreferenceSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: SalesOrder.name, schema: SalesOrderSchema },
      { name: DeliveryChallan.name, schema: DeliveryChallanSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: DirectExpense.name, schema: DirectExpenseSchema },
      { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
      { name: PartyPayment.name, schema: PartyPaymentSchema },
      { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
      { name: PaymentReminder.name, schema: PaymentReminderSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: BankStatement.name, schema: BankStatementSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: TdsDeposit.name, schema: TdsDepositSchema },
      { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema },
      { name: OrgMembership.name, schema: OrgMembershipSchema },
    ]),
    BullModule.registerQueue({ name: REPORT_AI_QUEUE }),
    GlModule, // AuditService
    MailModule, // scheduled reports go out by email
    OcrModule, // UsageMeterService: the model's tokens are metered per org
  ],
  controllers: [ReportsController, ManagementController, ReportCenterController],
  providers: [ReportsService, ManagementReportsService, BudgetsService, ReportCatalogService, ReportSchedulesService, ReportAiService, ReportAiProcessor, { provide: REPORT_MODEL, useClass: GeminiReportModel }, ReportDataService, ReportCenterService],
  exports: [ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService],
})
export class ReportsModule {}
