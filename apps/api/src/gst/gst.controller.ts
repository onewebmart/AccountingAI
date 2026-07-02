import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { GstService, ImportGstr2bLineDto } from './gst.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@Controller('gst')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.MANAGE_GST)
export class GstController {
  constructor(private readonly gstService: GstService) {}

  @Get('purchase-register')
  getPurchaseRegister(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getPurchaseRegister(req.user.orgId, period, buyerStateCode);
  }

  @Get('sales-register')
  getSalesRegister(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getSalesRegister(req.user.orgId, period, buyerStateCode ?? '27');
  }

  @Post('import-2b')
  importGstr2b(
    @Request() req: AuthRequest,
    @Body() body: { period: string; lines: ImportGstr2bLineDto[] },
  ) {
    return this.gstService.importGstr2b(req.user.orgId, body.period, body.lines);
  }

  @Post('reconcile-2b')
  reconcile2b(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.reconcile2b(req.user.orgId, period, buyerStateCode);
  }

  @Get('recon-lines')
  getReconLines(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.gstService.getReconLines(req.user.orgId, period);
  }

  @Get('itc-summary')
  getItcSummary(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getItcSummary(req.user.orgId, period, buyerStateCode);
  }

  @Post('recon-lines/:lineId/create-entry')
  createEntry(@Param('lineId') lineId: string, @Request() req: AuthRequest) {
    return this.gstService.createEntryFrom2bLine(lineId, req.user.orgId);
  }
}
