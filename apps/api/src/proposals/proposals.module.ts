import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProposedEntry, ProposedEntrySchema } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from './schemas/vendor-ledger-map.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { LearningService } from './learning.service';
import { SubledgerSyncService } from './subledger-sync.service';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
      { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
      // Sub-ledger mirrors written when a proposal is approved
      { name: Vendor.name, schema: VendorSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
    ]),
    GlModule, // for PostingService and AccountsService
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService, LearningService, SubledgerSyncService],
  exports: [ProposalsService, LearningService, MongooseModule],
})
export class ProposalsModule {}
