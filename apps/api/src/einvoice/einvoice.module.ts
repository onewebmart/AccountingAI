import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { GSP_PROVIDER, GspProvider, MockGsp } from './gsp.provider';

/**
 * GSP_PROVIDER picks the gateway. Only the mock exists until a GSP is
 * contracted: an unknown name stops the API rather than quietly pretending
 * invoices were registered.
 */
export function gspProvider(config: ConfigService): GspProvider {
  const which = config.get<string>('gsp.provider') ?? 'mock';
  if (which === 'mock') return new MockGsp();
  throw new Error(`GSP_PROVIDER "${which}" has no adapter yet: only "mock" is available.`);
}

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
  ],
  controllers: [EinvoiceController],
  providers: [EinvoiceService, { provide: GSP_PROVIDER, inject: [ConfigService], useFactory: gspProvider }],
  exports: [EinvoiceService],
})
export class EinvoiceModule {}
