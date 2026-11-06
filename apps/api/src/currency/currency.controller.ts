import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { CURRENCIES } from './currencies';
import { ForeignService } from './foreign.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODES = Object.keys(CURRENCIES);

class RateDto {
  @IsIn(CODES) currency: string;
  @Matches(DATE) date: string;
  @IsNumber() @Min(0.0001) rate: number;
  @IsOptional() @IsString() @Length(0, 60) source?: string | null;
}

class LineDto {
  @IsString() @Length(1, 500) description: string;
  @IsOptional() @IsMongoId() itemId?: string | null;
  @IsOptional() @IsString() @Length(0, 8) hsnSac?: string | null;
  @IsOptional() @IsString() @Length(0, 3) uqc?: string | null;
  @IsNumber() @Min(0.001) qty: number;
  @IsInt() @Min(0) rateMinor: number;
  @IsOptional() @IsMongoId() projectId?: string | null;
}

class ShippingBillDto {
  @IsString() @Length(1, 20) number: string;
  @Matches(DATE) date: string;
  @IsString() @Length(6, 6) portCode: string;
}

class InvoiceDto {
  @IsMongoId() customerId: string;
  @IsOptional() @IsIn(CODES) currency?: string;
  @IsOptional() @IsNumber() @Min(0.0001) rate?: number;
  @IsOptional() @IsString() @Length(1, 16) invoiceNumber?: string;
  @Matches(DATE) invoiceDate: string;
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
  @IsOptional() @ValidateNested() @Type(() => ShippingBillDto) shippingBill?: ShippingBillDto | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}

class BillDto {
  @IsMongoId() vendorId: string;
  @IsOptional() @IsIn(CODES) currency?: string;
  @IsOptional() @IsNumber() @Min(0.0001) rate?: number;
  @IsOptional() @IsString() @Length(1, 40) billNumber?: string;
  @Matches(DATE) billDate: string;
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
  @IsOptional() @IsIn([0, 5, 12, 18, 28]) reverseChargeIgstPct?: number;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}

class SettleDto {
  @Matches(DATE) paidOn: string;
  @IsInt() @Min(1) amountMinor: number;
  @IsNumber() @Min(0.0001) rate: number;
}

class PeriodDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period is a month like 2026-11' }) period: string;
}

class AdjustmentPreviewQuery {
  @IsIn(CODES, { message: 'Choose a currency.' }) currency: string;
  @Matches(DATE, { message: 'date must look like 2026-11-30' }) date: string;
  @Type(() => Number) @IsNumber({}, { message: 'rate is rupees for one unit' }) @Min(0.0001) rate: number;
}

class AdjustmentDto {
  @IsIn(CODES, { message: 'Choose a currency.' }) currency: string;
  @Matches(DATE, { message: 'date must look like 2026-11-30' }) date: string;
  @IsNumber({}, { message: 'rate is rupees for one unit' }) @Min(0.0001) rate: number;
  @IsString() @Length(1, 300, { message: 'Add a note of up to 300 characters.' }) notes: string;
}

class AdjustmentsQuery {
  @IsOptional() @IsIn(CODES) currency?: string;
  @IsOptional() @Matches(DATE, { message: 'from must look like 2026-04-01' }) from?: string;
  @IsOptional() @Matches(DATE, { message: 'to must look like 2026-11-30' }) to?: string;
}

/** Exchange rates, foreign-currency invoices and bills, their payments, and month-end revaluation. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('currency')
export class CurrencyController {
  constructor(private readonly foreign: ForeignService) {}

  @Get('currencies')
  @RequirePermission(Permission.VIEW_REPORTS)
  currencies() {
    return Object.entries(CURRENCIES).map(([code, c]) => ({ code, ...c }));
  }

  @Get('rates')
  @RequirePermission(Permission.VIEW_REPORTS)
  rates(@Request() req: AuthRequest, @Query('currency') currency?: string) {
    return this.foreign.rates(req.user.orgId, currency);
  }

  @Get('rates/on')
  @RequirePermission(Permission.VIEW_REPORTS)
  rateOn(@Request() req: AuthRequest, @Query('currency') currency: string, @Query('date') date: string) {
    return this.foreign.rateOn(req.user.orgId, (currency ?? '').toUpperCase(), date);
  }

  @Post('rates')
  @RequirePermission(Permission.MANAGE_SALES)
  setRate(@Request() req: AuthRequest, @Body() body: RateDto) {
    return this.foreign.setRate(req.user.orgId, req.user.sub, body);
  }

  @Get('documents')
  @RequirePermission(Permission.VIEW_REPORTS)
  documents(@Request() req: AuthRequest) {
    return this.foreign.documents(req.user.orgId);
  }

  @Post('invoices')
  @RequirePermission(Permission.MANAGE_SALES)
  createInvoice(@Request() req: AuthRequest, @Body() body: InvoiceDto) {
    return this.foreign.createInvoice(req.user.orgId, req.user.sub, body);
  }

  @Post('bills')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  createBill(@Request() req: AuthRequest, @Body() body: BillDto) {
    return this.foreign.createBill(req.user.orgId, req.user.sub, body);
  }

  @Post('invoices/:id/receive')
  @RequirePermission(Permission.MANAGE_SALES)
  receive(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: SettleDto) {
    return this.foreign.settle(req.user.orgId, req.user.sub, 'invoice', id, body);
  }

  @Post('bills/:id/pay')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  pay(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: SettleDto) {
    return this.foreign.settle(req.user.orgId, req.user.sub, 'bill', id, body);
  }

  @Get('revaluation')
  @RequirePermission(Permission.VIEW_REPORTS)
  revaluation(@Request() req: AuthRequest, @Query() q: PeriodDto) {
    return this.foreign.revaluation(req.user.orgId, q.period);
  }

  @Post('revaluation/propose')
  @RequirePermission(Permission.POST_JOURNAL)
  proposeRevaluation(@Request() req: AuthRequest, @Body() body: PeriodDto) {
    return this.foreign.proposeRevaluation(req.user.orgId, req.user.sub, body.period);
  }

  // Base currency adjustments: one currency at a date and a rate, through the review queue.
  @Get('adjustments')
  @RequirePermission(Permission.VIEW_REPORTS)
  adjustments(@Request() req: AuthRequest, @Query() q: AdjustmentsQuery) {
    return this.foreign.adjustmentsList(req.user.orgId, q);
  }

  @Get('adjustments/preview')
  @RequirePermission(Permission.VIEW_REPORTS)
  adjustmentPreview(@Request() req: AuthRequest, @Query() q: AdjustmentPreviewQuery) {
    return this.foreign.adjustmentPreview(req.user.orgId, q);
  }

  @Post('adjustments')
  @RequirePermission(Permission.POST_JOURNAL)
  proposeAdjustment(@Request() req: AuthRequest, @Body() body: AdjustmentDto) {
    return this.foreign.proposeAdjustment(req.user.orgId, req.user.sub, body);
  }
}
