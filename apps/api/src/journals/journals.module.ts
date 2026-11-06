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
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';

import { EInvoice, EInvoiceSchema } from '../einvoice/schemas/e-invoice.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ManualVouchersService } from './manual-vouchers.service';
import { ScheduledReversalsService } from './scheduled-reversals.service';
@Module({
  imports: [
    ApprovalsModule, // vouchers under approval policies
    GlModule,
    // A reversal reopens the invoice, bill, note or bank line that pointed at the voucher.
    MongooseModule.forFeature([
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      { name: TdsDeposit.name, schema: TdsDepositSchema },
      // A reversed receipt or payment across several documents, or an applied advance.
      { name: PartyPayment.name, schema: PartyPaymentSchema },
      { name: EInvoice.name, schema: EInvoiceSchema },
      // Read only: the customer or vendor a manual journal line names.
      { name: Customer.name, schema: CustomerSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
  ],
  controllers: [JournalsController],
  providers: [JournalsService, JournalReversalService, ManualVouchersService, ScheduledReversalsService],
  // ScheduledReversalsService: the daily books job posts journals' reversals on their dates.
  exports: [JournalsService, JournalReversalService, ScheduledReversalsService],
})
export class JournalsModule {}
