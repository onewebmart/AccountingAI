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
      { name: Budget.name, schema: BudgetSchema },
      { name: ReportSchedule.name, schema: ReportScheduleSchema },
      { name: AiSuggestion.name, schema: AiSuggestionSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
    ]),
    BullModule.registerQueue({ name: REPORT_AI_QUEUE }),
    GlModule, // AuditService
    MailModule, // scheduled reports go out by email
    OcrModule, // UsageMeterService: the model's tokens are metered per org
  ],
  controllers: [ReportsController, ManagementController],
  providers: [ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService, ReportAiService, ReportAiProcessor, { provide: REPORT_MODEL, useClass: GeminiReportModel }],
  exports: [ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService],
})
export class ReportsModule {}
