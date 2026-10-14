import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from './schemas/bank-statement-line.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { GlModule } from '../gl/gl.module';
import { SalesModule } from '../sales/sales.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { ReconciliationService } from './reconciliation.service';
import { BankingController } from './banking.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: BankStatement.name, schema: BankStatementSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: Journal.name, schema: JournalSchema },
      // Read here to find the open invoice or bill a bank line settles.
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
    ]),
    GlModule, // PostingService (transactions) and AuditService
    SalesModule, // settles a matched invoice
    PurchaseModule, // settles a matched bill
  ],
  controllers: [BankingController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class BankingModule {}
