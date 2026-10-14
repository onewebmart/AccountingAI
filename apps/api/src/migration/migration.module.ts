import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { GlModule } from '../gl/gl.module';
import { SalesModule } from '../sales/sales.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { IngestModule } from '../ingest/ingest.module';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';

/** Moving books in from Tally, Zoho Books or QuickBooks. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Vendor.name, schema: VendorSchema },
      // Opening-balance documents are written straight in, with the opening journal.
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
    ]),
    GlModule, // AccountsService, PostingService, AuditService, LedgerAccount
    SalesModule, // CustomersService
    PurchaseModule, // VendorsService
    IngestModule, // SpreadsheetParserService
  ],
  controllers: [MigrationController],
  providers: [MigrationService],
})
export class MigrationModule {}
