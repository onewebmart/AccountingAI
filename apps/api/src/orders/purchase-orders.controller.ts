import { Body, Controller, Get, Param, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PurchaseDocsService } from './purchase-docs.service';
import { DocLineDto } from './orders.controller';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class PoDto {
  @IsMongoId() vendorId: string;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Matches(DATE) expectedBy?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class PoLineQtyDto {
  @IsInt() @Min(0) poLine: number;
  @IsNumber() @Min(0) qty: number;
  @IsOptional() @IsNumber() @Min(0) rejectedQty?: number;
}

class ReceiveDto {
  @IsOptional() @Matches(DATE) date?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PoLineQtyDto) lines: PoLineQtyDto[];
  @IsOptional() @IsString() @Length(0, 60) vendorChallanNo?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class BillFromPoDto {
  @IsString() @Length(1, 60) billNumber: string;
  @IsOptional() @Matches(DATE) billDate?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PoLineQtyDto) lines?: PoLineQtyDto[];
}

class LinkBillDto {
  @IsMongoId() billId: string;
}

/** Purchase orders, goods received, and bills matched to both. None of it posts. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('orders')
@RequirePermission(Permission.MANAGE_PURCHASE)
export class PurchaseOrdersController {
  constructor(private readonly docs: PurchaseDocsService) {}

  @Get('purchase-orders')
  list(@Request() req: AuthRequest) {
    return this.docs.listPos(req.user.orgId);
  }

  @Post('purchase-orders')
  create(@Request() req: AuthRequest, @Body() body: PoDto) {
    return this.docs.createPo(req.user.orgId, req.user.sub, body);
  }

  @Post('purchase-orders/:id/send')
  send(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.sendPo(req.user.orgId, req.user.sub, id);
  }

  @Post('purchase-orders/:id/receive')
  receive(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ReceiveDto) {
    return this.docs.receive(req.user.orgId, req.user.sub, id, body);
  }

  @Post('purchase-orders/:id/bill')
  bill(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: BillFromPoDto) {
    return this.docs.billFromPo(req.user.orgId, req.user.sub, id, body);
  }

  @Post('purchase-orders/:id/link-bill')
  link(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: LinkBillDto) {
    return this.docs.linkBill(req.user.orgId, req.user.sub, id, body.billId);
  }

  @Post('purchase-orders/:id/close')
  close(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.setPoStatus(req.user.orgId, req.user.sub, id, 'closed');
  }

  @Post('purchase-orders/:id/cancel')
  cancel(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.setPoStatus(req.user.orgId, req.user.sub, id, 'cancelled');
  }

  @Get('purchase-orders/:id/pdf')
  async pdf(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    const { filename, content } = await this.docs.pdf(req.user.orgId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(content);
  }

  @Get('grns')
  grns(@Request() req: AuthRequest) {
    return this.docs.listGrns(req.user.orgId);
  }

  @Post('grns/:id/cancel')
  cancelGrn(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.cancelGrn(req.user.orgId, req.user.sub, id);
  }

  /** The bill against its PO and what was received; or the vendor's open POs to link it to. */
  @Get('bills/:billId/match')
  match(@Request() req: AuthRequest, @Param('billId') billId: string) {
    return this.docs.match(req.user.orgId, billId);
  }
}
