import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { IsInt, IsISO8601, IsMongoId, IsOptional, IsString, Length, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { TransfersService } from './transfers.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class RecordTransferDto {
  @IsMongoId()
  fromAccountId: string;

  @IsMongoId()
  toAccountId: string;

  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(1)
  amountPaise: number;

  @IsISO8601({}, { message: 'date must be a date like 2026-10-14' })
  date: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  narration?: string;

  @IsOptional()
  @IsMongoId()
  bankLineId?: string;
}

class PairLinesDto {
  @IsMongoId()
  lineId: string;

  @IsMongoId()
  otherLineId: string;
}

class UnpairDto {
  @IsMongoId()
  lineId: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('banking/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get('ledgers')
  @RequirePermission(Permission.VIEW_JOURNAL)
  ledgers(@Request() req: AuthRequest) {
    return this.transfers.moneyLedgers(req.user.orgId);
  }

  /** Lines that look like transfers. Suggestions only. */
  @Get('suggestions')
  @RequirePermission(Permission.VIEW_JOURNAL)
  suggestions(@Request() req: AuthRequest) {
    return this.transfers.suggestions(req.user.orgId);
  }

  /** Post a contra voucher, optionally accounting for a statement line. */
  @Post()
  @RequirePermission(Permission.POST_JOURNAL)
  record(@Request() req: AuthRequest, @Body() body: RecordTransferDto) {
    return this.transfers.record(req.user.orgId, req.user.sub, body);
  }

  @Post('pair')
  @RequirePermission(Permission.POST_JOURNAL)
  pair(@Request() req: AuthRequest, @Body() body: PairLinesDto) {
    return this.transfers.pair(req.user.orgId, req.user.sub, body.lineId, body.otherLineId);
  }

  @Post('unpair')
  @RequirePermission(Permission.POST_JOURNAL)
  unpair(@Request() req: AuthRequest, @Body() body: UnpairDto) {
    return this.transfers.unpair(req.user.orgId, req.user.sub, body.lineId);
  }
}
