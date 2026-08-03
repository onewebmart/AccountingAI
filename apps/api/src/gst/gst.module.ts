import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Gstr2bLine, Gstr2bLineSchema } from './schemas/gstr2b-line.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { GstService } from './gst.service';
import { GstController } from './gst.controller';
import { Gstr2bImportService } from './gstr2b-import.service';
import { IngestModule } from '../ingest/ingest.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
    ]),
    IngestModule, // spreadsheet parsing for GSTR-2B Excel downloads
  ],
  controllers: [GstController],
  providers: [GstService, Gstr2bImportService],
  exports: [GstService],
})
export class GstModule {}
