import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { ApprovalPolicy, ApprovalPolicySchema, ApprovalRequest, ApprovalRequestSchema } from './schemas/approval.schema';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';

/**
 * Approval policies and maker-checker. Standalone: the modules whose
 * postings it gates import it and register how to post once approved.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApprovalPolicy.name, schema: ApprovalPolicySchema },
      { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
      // Read for risk: the vendor's other bills.
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
    ]),
    GlModule, // AuditService, and the audit log read for bank changes
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
