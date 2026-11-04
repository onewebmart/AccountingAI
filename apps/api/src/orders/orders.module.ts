import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { withOrg } from '../database/tenant.plugin';
import { GlModule } from '../gl/gl.module';
import { ItemsModule } from '../items/items.module';
import { SalesModule } from '../sales/sales.module';
import { MailModule } from '../mail/mail.module';
import { OcrModule } from '../ocr/ocr.module';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { DeliveryChallan, DeliveryChallanSchema, Quote, QuoteSchema, SalesOrder, SalesOrderSchema } from './schemas/sales-docs.schema';
import { QUOTE_DRAFT_QUEUE, SalesDocsService } from './sales-docs.service';
import { GeminiQuoteModel, QUOTE_MODEL } from './quote-model';
import { OrdersController } from './orders.controller';

/** Quotes the model drafts from a message, one job each, off the request path. */
@Processor(QUOTE_DRAFT_QUEUE)
export class QuoteDraftProcessor extends WorkerHost {
  constructor(private readonly docs: SalesDocsService) {
    super();
  }

  async process(job: Job<{ orgId: string; suggestionId: string }>): Promise<void> {
    await withOrg(job.data.orgId, () => this.docs.runQuoteModel(job.data.orgId, job.data.suggestionId));
  }
}

/** What comes before an invoice: quotes, sales orders, delivery challans. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: SalesOrder.name, schema: SalesOrderSchema },
      { name: DeliveryChallan.name, schema: DeliveryChallanSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Item.name, schema: ItemSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: AiSuggestion.name, schema: AiSuggestionSchema },
    ]),
    BullModule.registerQueue({ name: QUOTE_DRAFT_QUEUE }),
    GlModule,
    ItemsModule,
    SalesModule, // SalesInvoicesService: converting makes a draft invoice
    MailModule,
    OcrModule, // UsageMeterService
  ],
  controllers: [OrdersController],
  providers: [SalesDocsService, QuoteDraftProcessor, { provide: QUOTE_MODEL, useClass: GeminiQuoteModel }],
  exports: [SalesDocsService],
})
export class OrdersModule {}
