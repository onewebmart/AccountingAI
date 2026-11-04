import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from './schemas/sales-invoice.schema';
import { CreditNote, CreditNoteSchema } from './schemas/credit-note.schema';
import { CreditNotesService } from './credit-notes.service';
import { CustomersService } from './customers.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesController } from './sales.controller';
import { MailModule } from '../mail/mail.module';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { PartyPaymentsModule } from '../payments/party-payments.module';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      // Read for the seller's details printed on the invoice PDF.
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    GlModule, // for PostingService
    PartyPaymentsModule, // a note larger than what is owed becomes the party's credit
    MailModule, // emails the invoice PDF
  ],
  controllers: [SalesController],
  providers: [CustomersService, SalesInvoicesService, CreditNotesService, InvoiceDeliveryService],
  exports: [CustomersService, SalesInvoicesService, CreditNotesService, InvoiceDeliveryService],
})
export class SalesModule {}
