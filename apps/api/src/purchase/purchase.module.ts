import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { VendorsService } from './vendors.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseController } from './purchase.controller';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
    ]),
    GlModule, // for PostingService
  ],
  controllers: [PurchaseController],
  providers: [VendorsService, PurchaseBillsService],
  exports: [VendorsService, PurchaseBillsService],
})
export class PurchaseModule {}
