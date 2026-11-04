import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { FixedAsset, FixedAssetSchema } from './schemas/fixed-asset.schema';
import { AdjustmentSchedule, AdjustmentScheduleSchema } from './schemas/adjustment-schedule.schema';
import { AdjustmentsService } from './adjustments.service';
import { SchedulesService } from './schedules.service';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import { MonthEndSweepService } from './month-end-sweep.service';
import { MonthEndController } from './month-end.controller';

/** Recurring journals' drafting, accruals and prepaids, the asset register, and the month-end assistant. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FixedAsset.name, schema: FixedAssetSchema },
      { name: AdjustmentSchedule.name, schema: AdjustmentScheduleSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService, the chart and journals
  ],
  controllers: [MonthEndController],
  providers: [AdjustmentsService, SchedulesService, AssetsService, AssistantService, MonthEndSweepService],
  exports: [AdjustmentsService, MonthEndSweepService, AssetsService],
})
export class MonthEndModule {}
