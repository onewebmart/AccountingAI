import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { todayIst } from '../automation/schedule';
import { ITEM_GST_RATES, UQC_CODES } from '../items/hsn';
import { MOVE_REASONS, MoveReason } from './schemas/stock-move.schema';
import { DocKind, StockService } from './stock.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ADJUST_REASONS = MOVE_REASONS.filter((r) => r !== 'opening');

class OpeningDto {
  @IsMongoId() itemId: string;
  @IsNumber() @Min(0.001) qty: number;
  @IsInt({ message: 'ratePaise must be an integer number of paise' }) @Min(0) ratePaise: number;
  @Matches(DATE, { message: 'date must look like 2026-04-01' }) date: string;
}

class AdjustDto {
  @IsMongoId() itemId: string;
  @Matches(DATE, { message: 'date must look like 2026-11-30' }) date: string;
  @IsIn(ADJUST_REASONS) reason: Exclude<MoveReason, 'opening'>;
  @IsOptional() @IsNumber() qty?: number | null;
  @IsOptional() @IsNumber() @Min(0) countedQty?: number | null;
  @IsOptional() @IsInt({ message: 'ratePaise must be an integer number of paise' }) @Min(0) ratePaise?: number | null;
  @IsOptional() @IsString() @Length(0, 60) ref?: string | null;
  @IsOptional() @IsString() @Length(0, 300) note?: string | null;
}

class NewItemDto {
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @Length(0, 8) hsnSac?: string | null;
  @IsOptional() @IsIn(UQC_CODES) uqc?: string | null;
  @IsOptional() @IsIn(ITEM_GST_RATES) gstRatePct?: number | null;
}

class LinkDto {
  @IsIn(['bill', 'invoice']) docKind: DocKind;
  @IsMongoId() docId: string;
  @IsInt() @Min(0) @Max(999) line: number;
  @IsOptional() @IsMongoId() itemId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => NewItemDto) newItem?: NewItemDto | null;
  @IsOptional() @IsBoolean() notStock?: boolean;
}

class KindDto {
  @IsOptional() @IsIn(['bill', 'invoice']) kind?: DocKind;
}

class ReorderLineDto {
  @IsMongoId() itemId: string;
  @IsNumber() @Min(0.001) qty: number;
}

class ReorderDto {
  @IsMongoId() vendorId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReorderLineDto) lines: ReorderLineDto[];
}

class PeriodDto {
  @Matches(PERIOD, { message: 'period is a month like 2026-11' }) period: string;
}

/** Stock on hand, its moves and value, line-to-item links, reorders and the stock entries. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('summary')
  @RequirePermission(Permission.VIEW_REPORTS)
  summary(@Request() req: AuthRequest, @Query('asOf') asOf?: string) {
    return this.stock.summary(req.user.orgId, asOf || todayIst());
  }

  @Get('items/:itemId/ledger')
  @RequirePermission(Permission.VIEW_REPORTS)
  ledger(@Request() req: AuthRequest, @Param('itemId') itemId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.stock.ledger(req.user.orgId, itemId, from, to || todayIst());
  }

  @Get('moves')
  @RequirePermission(Permission.VIEW_REPORTS)
  moves(@Request() req: AuthRequest, @Query('itemId') itemId?: string) {
    return this.stock.listMoves(req.user.orgId, itemId);
  }

  @Post('opening')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  setOpening(@Request() req: AuthRequest, @Body() body: OpeningDto) {
    return this.stock.setOpening(req.user.orgId, req.user.sub, body);
  }

  @Post('adjustments')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  adjust(@Request() req: AuthRequest, @Body() body: AdjustDto) {
    return this.stock.adjust(req.user.orgId, req.user.sub, body);
  }

  @Post('moves/:id/void')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  voidMove(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.stock.voidMove(req.user.orgId, req.user.sub, id);
  }

  @Get('lines')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  lines(@Request() req: AuthRequest, @Query() q: KindDto) {
    return this.stock.unlinkedLines(req.user.orgId, q.kind ?? 'bill');
  }

  @Post('lines/link')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  link(@Request() req: AuthRequest, @Body() body: LinkDto) {
    return this.stock.linkLine(req.user.orgId, req.user.sub, body);
  }

  @Post('lines/link-from-history')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  linkFromHistory(@Request() req: AuthRequest, @Body() body: KindDto) {
    return this.stock.linkFromHistory(req.user.orgId, req.user.sub, body.kind ?? 'bill');
  }

  @Post('reorder')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  reorder(@Request() req: AuthRequest, @Body() body: ReorderDto) {
    return this.stock.orderReorders(req.user.orgId, req.user.sub, body);
  }

  @Get('opening-entry')
  @RequirePermission(Permission.VIEW_REPORTS)
  opening(@Request() req: AuthRequest) {
    return this.stock.opening(req.user.orgId);
  }

  @Post('opening-entry/propose')
  @RequirePermission(Permission.POST_JOURNAL)
  proposeOpening(@Request() req: AuthRequest) {
    return this.stock.proposeOpening(req.user.orgId, req.user.sub);
  }

  @Get('closing')
  @RequirePermission(Permission.VIEW_REPORTS)
  closing(@Request() req: AuthRequest, @Query() q: PeriodDto) {
    return this.stock.closing(req.user.orgId, q.period);
  }

  @Post('closing/propose')
  @RequirePermission(Permission.POST_JOURNAL)
  proposeClosing(@Request() req: AuthRequest, @Body() body: PeriodDto) {
    return this.stock.proposeClosing(req.user.orgId, req.user.sub, body.period);
  }
}
