import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from './schemas/sales-invoice.schema';
import { CustomersService } from './customers.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesController } from './sales.controller';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
    ]),
    GlModule, // for PostingService
  ],
  controllers: [SalesController],
  providers: [CustomersService, SalesInvoicesService],
  exports: [CustomersService, SalesInvoicesService],
})
export class SalesModule {}
