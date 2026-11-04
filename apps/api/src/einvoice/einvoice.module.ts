import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { JournalsModule } from '../journals/journals.module';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { EInvoice, EInvoiceSchema } from './schemas/e-invoice.schema';
import { EWayBill, EWayBillSchema } from './schemas/e-way-bill.schema';
import { EinvoiceService } from './einvoice.service';
import { EinvoiceController } from './einvoice.controller';
import { GspModule } from '../gsp/gsp.module';

/** E-invoices (IRN) and e-way bills for posted sales. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EInvoice.name, schema: EInvoiceSchema },
      { name: EWayBill.name, schema: EWayBillSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    GlModule, // AuditService
    JournalsModule, // JournalReversalService: cancelling an IRN reverses the sale
    GspModule,
  ],
  controllers: [EinvoiceController],
  providers: [EinvoiceService],
  exports: [EinvoiceService],
})
export class EinvoiceModule {}
