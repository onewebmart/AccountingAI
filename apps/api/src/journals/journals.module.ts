import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JournalsController } from './journals.controller';
import { JournalsService } from './journals.service';
import { JournalReversalService } from './journal-reversal.service';
import { GlModule } from '../gl/gl.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';

@Module({
  imports: [
    GlModule,
    // A reversal reopens the invoice, bill, note or bank line that pointed at the voucher.
    MongooseModule.forFeature([
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      { name: TdsDeposit.name, schema: TdsDepositSchema },
    ]),
  ],
  controllers: [JournalsController],
  providers: [JournalsService, JournalReversalService],
  exports: [JournalsService],
})
export class JournalsModule {}
