import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ProposedEntry, ProposedEntrySchema } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from './schemas/vendor-ledger-map.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { LearningService } from './learning.service';
import { SubledgerSyncService } from './subledger-sync.service';
import { GlModule } from '../gl/gl.module';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { ExpenseCategorizerService } from './categorisation/expense-categorizer.service';
import { BankCategorisationService, CATEGORISE_QUEUE } from './categorisation/bank-categorisation.service';
import { CategorisationProcessor } from './categorisation/categorisation.processor';
import { CategorisationController } from './categorisation/categorisation.controller';
import { CATEGORY_MODEL, GeminiCategoryModel } from './categorisation/category-model';

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
      // The upload moves to APPROVED / REJECTED with its proposal
      { name: UploadedDocument.name, schema: DocumentSchema },
      // Unmatched bank lines are categorised into proposals, and matched on approval
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
    ]),
    BullModule.registerQueue({ name: CATEGORISE_QUEUE }),
    GlModule, // for PostingService and AccountsService
  ],
  controllers: [ProposalsController, CategorisationController],
  providers: [
    ProposalsService,
    LearningService,
    SubledgerSyncService,
    ExpenseCategorizerService,
    BankCategorisationService,
    CategorisationProcessor,
    // Gemini when a key is configured; without one, rules and past choices still apply.
    { provide: CATEGORY_MODEL, useClass: GeminiCategoryModel },
  ],
  exports: [ProposalsService, LearningService, ExpenseCategorizerService, MongooseModule],
})
export class ProposalsModule {}
