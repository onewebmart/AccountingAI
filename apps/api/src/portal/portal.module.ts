import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PortalLink, PortalLinkSchema } from './schemas/portal-link.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { SalesModule } from '../sales/sales.module';
import { GlModule } from '../gl/gl.module';
import { PortalService } from './portal.service';
import { PortalController, PortalLinksController } from './portal.controller';

/** Customers' read-only links to their own invoices. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PortalLink.name, schema: PortalLinkSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    SalesModule, // the invoice PDF
    GlModule, // AuditService
  ],
  controllers: [PortalLinksController, PortalController],
  providers: [PortalService],
})
export class PortalModule {}
