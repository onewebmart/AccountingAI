import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { ReportsModule } from '../reports/reports.module';
import { GlModule } from '../gl/gl.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { RecurringTemplate, RecurringTemplateSchema } from '../automation/schemas/recurring-template.schema';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      // Read for the cash forecast.
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
    ]),
    ReportsModule,
    GlModule, // AccountsService resolves the bank, cash and tax ledgers
  ],
  controllers: [InsightsController],
  providers: [InsightsService, ForecastService],
  exports: [InsightsService, ForecastService],
})
export class InsightsModule {}
