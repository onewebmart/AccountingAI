import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ItemsModule } from '../items/items.module';
import { SalesModule } from '../sales/sales.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { MonthEndModule } from '../month-end/month-end.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { ExchangeRate, ExchangeRateSchema } from './schemas/exchange-rate.schema';
import { ForeignService } from './foreign.service';
import { CurrencyController } from './currency.controller';

/** Foreign currencies: rates, documents, payments with their exchange difference, and revaluation. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService
    ItemsModule, // ItemsService: lines from the item master
    SalesModule, // SalesInvoicesService
    PurchaseModule, // PurchaseBillsService
    MonthEndModule, // AdjustmentsService: the revaluation goes to the review queue
  ],
  controllers: [CurrencyController],
  providers: [ForeignService],
  exports: [ForeignService],
})
export class CurrencyModule {}
