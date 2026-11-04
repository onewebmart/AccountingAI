import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { EWB_CANCEL_REASONS, EXTEND_REASONS, EinvoiceService, IRN_CANCEL_REASONS, VEHICLE_REASONS } from './einvoice.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class CancelIrnDto {
  @IsIn(Object.keys(IRN_CANCEL_REASONS)) reasonCode: string;
  @IsString() @Length(1, 100) remark: string;
}

class EwbDto {
  @IsInt() @Min(1) @Max(4000) distanceKm: number;
  @IsIn(['road', 'rail', 'air', 'ship']) mode: 'road' | 'rail' | 'air' | 'ship';
  @IsOptional() @IsString() @Length(0, 20) vehicleNo?: string;
  @IsOptional() @IsIn(['regular', 'odc']) vehicleType?: 'regular' | 'odc';
  @IsOptional() @IsString() @Length(0, 15) transporterId?: string;
  @IsOptional() @IsString() @Length(0, 100) transporterName?: string;
  @IsOptional() @IsString() @Length(0, 30) transDocNo?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) transDocDate?: string;
}

class VehicleDto {
  @IsString() @Length(4, 20) vehicleNo: string;
  @IsIn(Object.keys(VEHICLE_REASONS)) reasonCode: string;
  @IsOptional() @IsString() @Length(0, 100) remark?: string;
}

class ExtendDto {
  @IsInt() @Min(1) @Max(4000) remainingKm: number;
  @IsIn(Object.keys(EXTEND_REASONS)) reasonCode: string;
  @IsOptional() @IsString() @Length(0, 100) remark?: string;
}

class CancelEwbDto {
  @IsIn(Object.keys(EWB_CANCEL_REASONS)) reasonCode: string;
  @IsOptional() @IsString() @Length(0, 100) remark?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('einvoice')
export class EinvoiceController {
  constructor(private readonly einvoices: EinvoiceService) {}

  /** Whether it applies, what the IRP would refuse and how to fix it, and what exists. */
  @Get('invoices/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  view(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.einvoices.view(req.user.orgId, id);
  }

  @Post('invoices/:id/irn')
  @RequirePermission(Permission.MANAGE_SALES)
  generate(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.einvoices.generateIrn(req.user.orgId, req.user.sub, id);
  }

  /** Cancels at the IRP and reverses the sale: a posting, so it needs the right to post. */
  @Post('invoices/:id/irn/cancel')
  @RequirePermission(Permission.POST_JOURNAL)
  cancel(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CancelIrnDto) {
    return this.einvoices.cancelIrn(req.user.orgId, req.user.sub, id, body);
  }

  @Get('invoices/:id/eway/suggestion')
  @RequirePermission(Permission.MANAGE_SALES)
  suggestion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.einvoices.ewbSuggestion(req.user.orgId, id);
  }

  @Post('invoices/:id/eway')
  @RequirePermission(Permission.MANAGE_SALES)
  generateEwb(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: EwbDto) {
    return this.einvoices.generateEwb(req.user.orgId, req.user.sub, id, body);
  }

  @Post('eway/:id/vehicle')
  @RequirePermission(Permission.MANAGE_SALES)
  vehicle(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: VehicleDto) {
    return this.einvoices.updateVehicle(req.user.orgId, req.user.sub, id, body);
  }

  @Post('eway/:id/extend')
  @RequirePermission(Permission.MANAGE_SALES)
  extend(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ExtendDto) {
    return this.einvoices.extendEwb(req.user.orgId, req.user.sub, id, body);
  }

  @Post('eway/:id/cancel')
  @RequirePermission(Permission.MANAGE_SALES)
  cancelEwb(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CancelEwbDto) {
    return this.einvoices.cancelEwb(req.user.orgId, req.user.sub, id, body);
  }
}
