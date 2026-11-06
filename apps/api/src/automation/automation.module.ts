import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RecurringTemplate, RecurringTemplateSchema } from './schemas/recurring-template.schema';
import { PaymentReminder, PaymentReminderSchema } from './schemas/payment-reminder.schema';
import { ReminderSettings, ReminderSettingsSchema } from './schemas/reminder-settings.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { MESSAGING_PROVIDER } from '../crm/messaging/messaging.provider.interface';
import { MockMessagingProvider } from '../crm/messaging/mock-messaging.provider';
import { GlModule } from '../gl/gl.module';
import { SalesModule } from '../sales/sales.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { RecurringService } from './recurring.service';
import { BOOKS_AUTOMATION_QUEUE, DAILY_BOOKS_JOB, RemindersService } from './reminders.service';
import { AutomationProcessor } from './automation.processor';
import { AutomationController } from './automation.controller';

/**
 * Money in and out on a schedule: recurring bills and invoices, drafted on
 * their dates, and payment reminders to customers.
 */
import { MonthEndModule } from '../month-end/month-end.module';
import { ReportsModule } from '../reports/reports.module';
import { DirectExpensesModule } from '../direct-expenses/direct-expenses.module';
import { ItemsModule } from '../items/items.module';
import { JournalsModule } from '../journals/journals.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
      { name: PaymentReminder.name, schema: PaymentReminderSchema },
      { name: ReminderSettings.name, schema: ReminderSettingsSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    BullModule.registerQueue({ name: BOOKS_AUTOMATION_QUEUE }),
    GlModule, // AuditService
    SalesModule, // SalesInvoicesService drafts recurring invoices
    PurchaseModule, // PurchaseBillsService drafts recurring bills
    MonthEndModule, // recurring journals go to the review queue; the daily month-end sweep
    ReportsModule, // scheduled report emails go out in the daily sweep
    DirectExpensesModule, // recurring expenses are drafted as expenses; it imports only the ledger and approvals, so no cycle
    ItemsModule, // recurring invoice lines that pick an item
    JournalsModule, // journals' scheduled reversals post in the daily sweep
  ],
  controllers: [AutomationController],
  providers: [
    RecurringService,
    RemindersService,
    AutomationProcessor,
    // The same seam as CRM messages: swap the mock for a real WhatsApp or
    // email adapter here, and no reminder code changes.
    { provide: MESSAGING_PROVIDER, useClass: MockMessagingProvider },
  ],
})
export class AutomationModule implements OnModuleInit {
  private readonly logger = new Logger(AutomationModule.name);

  constructor(@InjectQueue(BOOKS_AUTOMATION_QUEUE) private readonly queue: Queue) {}

  /**
   * Schedules the daily sweep once, at boot. A fixed jobId with a repeat
   * pattern re-registers the same schedule on restart instead of stacking
   * copies. 06:30 IST: drafts and reminders are ready before the working day.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        DAILY_BOOKS_JOB,
        {},
        { jobId: DAILY_BOOKS_JOB, repeat: { pattern: '30 6 * * *', tz: 'Asia/Kolkata' }, removeOnComplete: true },
      );
      this.logger.log('Daily books sweep scheduled for 06:30 IST');
    } catch (err) {
      this.logger.error(`Could not schedule the books sweep: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
