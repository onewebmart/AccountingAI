import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PartyPayment, PartyPaymentSchema } from './schemas/party-payment.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PaymentRun, PaymentRunSchema } from './schemas/payment-run.schema';
import { PaymentRunsService } from './payment-runs.service';
import { PaymentRunsController } from './payment-runs.controller';
import { OnlinePaymentsService } from './online-payments.service';
import { OnlinePaymentsController, PaymentWebhooksController } from './online-payments.controller';
import { MockPaymentLinkProvider, PAYMENT_LINK_PROVIDER, RazorpayPaymentLinkProvider } from './gateway/payment-link.provider';
import { GlModule } from '../gl/gl.module';
import { PartyPaymentsService } from './party-payments.service';
import { PartyPaymentsController } from './party-payments.controller';

/** Receipts and payments across many invoices or bills, and advances. */
import { ApprovalsModule } from '../approvals/approvals.module';
@Module({
  imports: [
    ApprovalsModule, // payments out under approval policies
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
  controllers: [PartyPaymentsController, PaymentRunsController, OnlinePaymentsController, PaymentWebhooksController],
  providers: [
    PartyPaymentsService,
    PaymentRunsService,
    OnlinePaymentsService,
    RazorpayPaymentLinkProvider,
    MockPaymentLinkProvider,
    // Razorpay once its keys are configured; until then, a test provider that takes no money.
    {
      provide: PAYMENT_LINK_PROVIDER,
      inject: [ConfigService, RazorpayPaymentLinkProvider, MockPaymentLinkProvider],
      useFactory: (config: ConfigService, razorpay: RazorpayPaymentLinkProvider, mock: MockPaymentLinkProvider) =>
        config.get<string>('razorpay.keyId') && config.get<string>('razorpay.keySecret') ? razorpay : mock,
    },
  ],
  exports: [PartyPaymentsService],
})
export class PartyPaymentsModule {}
