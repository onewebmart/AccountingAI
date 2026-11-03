import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { DebitNote, DebitNoteSchema } from './schemas/debit-note.schema';
import { DebitNotesService } from './debit-notes.service';
import { VendorsService } from './vendors.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseController } from './purchase.controller';
import { PartyPaymentsModule } from '../payments/party-payments.module';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
    ]),
    GlModule, // for PostingService
    PartyPaymentsModule, // a note larger than what is owed becomes the party's credit
  ],
  controllers: [PurchaseController],
  providers: [VendorsService, PurchaseBillsService, DebitNotesService],
  exports: [VendorsService, PurchaseBillsService, DebitNotesService],
})
export class PurchaseModule {}
