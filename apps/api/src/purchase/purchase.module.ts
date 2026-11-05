import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { DebitNote, DebitNoteSchema } from './schemas/debit-note.schema';
import { DebitNotesService } from './debit-notes.service';
import { BillsFromLinesService } from './bills-from-lines.service';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { VendorsService } from './vendors.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseController } from './purchase.controller';
import { PartyPaymentsModule } from '../payments/party-payments.module';
import { GlModule } from '../gl/gl.module';

import { ItemsModule } from '../items/items.module';
import { ApprovalsModule } from '../approvals/approvals.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: DebitNote.name, schema: DebitNoteSchema },
      // Read only: our state, against the vendor's, decides CGST+SGST or IGST on a bill typed by lines.
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    GlModule, // for PostingService
    ItemsModule, // lines that pick an item
    ApprovalsModule, // bills and bill payments under approval policies
    PartyPaymentsModule, // a note larger than what is owed becomes the party's credit
  ],
  controllers: [PurchaseController],
  providers: [VendorsService, PurchaseBillsService, DebitNotesService, BillsFromLinesService],
  exports: [VendorsService, PurchaseBillsService, DebitNotesService],
})
export class PurchaseModule {}
