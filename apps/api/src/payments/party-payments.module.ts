import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PartyPayment, PartyPaymentSchema } from './schemas/party-payment.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PaymentRun, PaymentRunSchema } from './schemas/payment-run.schema';
import { PaymentRunsService } from './payment-runs.service';
import { PaymentRunsController } from './payment-runs.controller';
import { GlModule } from '../gl/gl.module';
import { PartyPaymentsService } from './party-payments.service';
import { PartyPaymentsController } from './party-payments.controller';

/** Receipts and payments across many invoices or bills, and advances. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PartyPayment.name, schema: PartyPaymentSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: PaymentRun.name, schema: PaymentRunSchema },
    ]),
    GlModule,
  ],
  controllers: [PartyPaymentsController, PaymentRunsController],
  providers: [PartyPaymentsService, PaymentRunsService],
  exports: [PartyPaymentsService],
})
export class PartyPaymentsModule {}
