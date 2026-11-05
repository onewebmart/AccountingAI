import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { GlModule } from '../gl/gl.module';
import { OcrModule } from '../ocr/ocr.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { Item, ItemSchema } from './schemas/item.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { HSN_QUEUE, ItemsService } from './items.service';
import { HsnSuggestionProcessor } from './items.processor';
import { ItemsController } from './items.controller';
import { GeminiHsnModel, HSN_MODEL } from './hsn-model';

/** The item master: what a business sells and buys, with its GST classification. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Item.name, schema: ItemSchema },
      { name: Vendor.name, schema: VendorSchema }, // read only: an item's preferred vendor
      { name: Project.name, schema: ProjectSchema },
      { name: AiSuggestion.name, schema: AiSuggestionSchema },
      // Read for the codes this org already used on its lines.
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
    ]),
    BullModule.registerQueue({ name: HSN_QUEUE }),
    GlModule, // AuditService, the chart of accounts
    OcrModule, // UsageMeterService: AI spend is metered per org
  ],
  controllers: [ItemsController],
  providers: [ItemsService, HsnSuggestionProcessor, { provide: HSN_MODEL, useClass: GeminiHsnModel }],
  exports: [ItemsService],
})
export class ItemsModule {}
