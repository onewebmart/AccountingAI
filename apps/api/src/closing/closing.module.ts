import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClosingRun, ClosingRunSchema } from './schemas/closing-run.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { GlModule } from '../gl/gl.module';
import { ClosingService } from './closing.service';
import { ClosingController } from './closing.controller';

import { MonthEndModule } from '../month-end/month-end.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClosingRun.name, schema: ClosingRunSchema },
      // Read for the closing checklist.
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService; Journal, LedgerAccount and PeriodLock models
    MonthEndModule, // depreciation due, for the checklist
  ],
  controllers: [ClosingController],
  providers: [ClosingService],
})
export class ClosingModule {}
