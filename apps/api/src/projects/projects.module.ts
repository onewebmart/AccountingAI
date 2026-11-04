import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { withOrg } from '../database/tenant.plugin';
import { GlModule } from '../gl/gl.module';
import { ItemsModule } from '../items/items.module';
import { SalesModule } from '../sales/sales.module';
import { OcrModule } from '../ocr/ocr.module';
import { ReportsModule } from '../reports/reports.module';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { GeminiReportModel, REPORT_MODEL } from '../reports/report-model';
import { Project, ProjectSchema } from './schemas/project.schema';
import { TimeEntry, TimeEntrySchema } from './schemas/time-entry.schema';
import { PROJECT_AI_QUEUE, ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

/** Invoice lines worded from time notes, one job each, off the request path. */
@Processor(PROJECT_AI_QUEUE)
export class ProjectAiProcessor extends WorkerHost {
  constructor(private readonly projects: ProjectsService) {
    super();
  }

  async process(job: Job<{ orgId: string; suggestionId: string }>): Promise<void> {
    await withOrg(job.data.orgId, () => this.projects.runTimeLines(job.data.orgId, job.data.suggestionId));
  }
}

/** Projects, timesheets, and invoices drafted from unbilled time. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      { name: Item.name, schema: ItemSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: User.name, schema: UserSchema },
      { name: AiSuggestion.name, schema: AiSuggestionSchema },
    ]),
    BullModule.registerQueue({ name: PROJECT_AI_QUEUE }),
    GlModule, // AuditService
    ItemsModule, // ItemsService: the project's service item fills each line
    SalesModule, // SalesInvoicesService: unbilled time becomes a draft invoice
    OcrModule, // UsageMeterService
    ReportsModule, // ManagementReportsService: each project's income, costs and time
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAiProcessor, { provide: REPORT_MODEL, useClass: GeminiReportModel }],
  exports: [ProjectsService],
})
export class ProjectsModule {}
