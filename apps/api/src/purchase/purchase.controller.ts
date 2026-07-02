import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Permission, BillStatus } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VendorsService, CreateVendorInput } from './vendors.service';
import { PurchaseBillsService, CreateBillInput } from './purchase-bills.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('v1/purchase')
export class PurchaseController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly billsService: PurchaseBillsService,
  ) {}

  // ── Vendors ───────────────────────────────────────────────────────────────

  @Get('vendors')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  listVendors(@Request() req: AuthRequest) {
    return this.vendorsService.list(req.user.orgId);
  }

  @Post('vendors')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  createVendor(@Request() req: AuthRequest, @Body() body: Omit<CreateVendorInput, 'orgId'>) {
    return this.vendorsService.create({ ...body, orgId: req.user.orgId });
  }

  @Get('vendors/:id')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  getVendor(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.vendorsService.findById(id, req.user.orgId);
  }

  @Get('vendors/:id/outstanding')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  vendorOutstanding(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.vendorsService.outstanding(id, req.user.orgId).then((paise) => ({ paise }));
  }

  @Get('ap-ageing')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  apAgeing(@Request() req: AuthRequest) {
    return this.vendorsService.apAgeing(req.user.orgId);
  }

  // ── Bills ────────────────────────────────────────────────────────────────

  @Get('bills')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  listBills(@Request() req: AuthRequest, @Query('status') status?: BillStatus) {
    return this.billsService.list(req.user.orgId, status);
  }

  @Post('bills')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  createBill(@Request() req: AuthRequest, @Body() body: Omit<CreateBillInput, 'orgId'>) {
    return this.billsService.create({ ...body, orgId: req.user.orgId });
  }

  @Get('bills/:id')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  getBill(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.billsService.findById(id, req.user.orgId);
  }

  @Post('bills/:id/post')
  @RequirePermission(Permission.POST_JOURNAL)
  postBill(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.billsService.post(id, req.user.orgId, req.user.sub);
  }

  @Post('bills/:id/pay')
  @RequirePermission(Permission.POST_JOURNAL)
  payBill(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.billsService.markPaid(id, req.user.orgId, req.user.sub);
  }
}
