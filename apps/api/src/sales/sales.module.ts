import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from './schemas/sales-invoice.schema';
import { CreditNote, CreditNoteSchema } from './schemas/credit-note.schema';
import { CreditNotesService } from './credit-notes.service';
import { CustomersService } from './customers.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesController } from './sales.controller';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
    ]),
    GlModule, // for PostingService
  ],
  controllers: [SalesController],
  providers: [CustomersService, SalesInvoicesService, CreditNotesService],
  exports: [CustomersService, SalesInvoicesService, CreditNotesService],
})
export class SalesModule {}
