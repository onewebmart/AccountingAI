import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TdsDeposit, TdsDepositSchema } from './schemas/tds-deposit.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { GlModule } from '../gl/gl.module';
import { TdsService } from './tds.service';
import { TdsController } from './tds.controller';

import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TdsDeposit.name, schema: TdsDepositSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    GlModule,
  ],
  controllers: [TdsController],
  providers: [TdsService],
  exports: [TdsService],
})
export class TdsModule {}
