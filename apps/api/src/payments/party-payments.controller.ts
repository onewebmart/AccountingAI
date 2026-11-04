import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsMongoId, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PartyPaymentsService, PaymentKind } from './party-payments.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: UserRole };
}

class AllocationDto {
  @IsMongoId()
  documentId: string;

  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(0)
  amountPaise: number;

  @IsOptional()
  @IsInt({ message: 'tdsPaise must be whole paise' })
  @Min(0)
  tdsPaise?: number;
}

class RecordPaymentDto {
  @IsIn(['receipt', 'payment'])
  kind: PaymentKind;

  @IsMongoId()
  partyId: string;

  @IsISO8601({}, { message: 'date must be a date like 2026-10-14' })
  date: string;

  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(0)
  amountPaise: number;

  @IsOptional()
  @IsIn(['bank', 'cash', 'gateway'])
  via?: 'bank' | 'cash' | 'gateway';

  @IsOptional()
  @IsString()
  @Length(0, 120)
  reference?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations: AllocationDto[];
}

class ApplyAdvanceDto {
  @IsMongoId()
  documentId: string;

  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(1)
  amountPaise: number;

  @IsISO8601({}, { message: 'date must be a date like 2026-10-14' })
  date: string;
}

class RefundDto {
  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(1)
  amountPaise: number;

  @IsISO8601({}, { message: 'date must be a date like 2026-10-14' })
  date: string;

  @IsOptional()
  @IsIn(['bank', 'cash'])
  via?: 'bank' | 'cash';
}

class SuggestDto {
  @IsIn(['receipt', 'payment'])
  kind: PaymentKind;

  @IsMongoId()
  partyId: string;

  @IsInt()
  @Min(0)
  amountPaise: number;

  /** A remittance advice or bank narration that may name the invoices. */
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  text?: string;
}

/** Receipts from customers need sales rights; payments to vendors, purchase rights. */
function assertMayHandle(role: UserRole, kind: PaymentKind) {
  const needed = kind === 'receipt' ? Permission.MANAGE_SALES : Permission.MANAGE_PURCHASE;
  if (!hasPermission(role, needed)) throw new ForbiddenException(`You need ${needed} to record this.`);
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('payments')
export class PartyPaymentsController {
  constructor(private readonly payments: PartyPaymentsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_JOURNAL)
  list(@Request() req: AuthRequest, @Query('kind') kind?: PaymentKind, @Query('partyId') partyId?: string) {
    return this.payments.list(req.user.orgId, kind === 'payment' ? 'payment' : kind === 'receipt' ? 'receipt' : undefined, partyId);
  }

  @Get('advances')
  @RequirePermission(Permission.VIEW_JOURNAL)
  advances(@Request() req: AuthRequest, @Query('kind') kind?: PaymentKind) {
    return this.payments.advances(req.user.orgId, kind === 'payment' ? 'payment' : 'receipt');
  }

  /** Which open documents a lump sum most likely pays. Changes nothing. */
  @Post('suggest')
  @RequirePermission(Permission.VIEW_JOURNAL)
  suggest(@Request() req: AuthRequest, @Body() body: SuggestDto) {
    return this.payments.suggest(req.user.orgId, body.kind, body.partyId, body.amountPaise, body.text);
  }

  @Post()
  @RequirePermission(Permission.POST_JOURNAL)
  record(@Request() req: AuthRequest, @Body() body: RecordPaymentDto) {
    assertMayHandle(req.user.role, body.kind);
    return this.payments.record(req.user.orgId, req.user.sub, body, { actorRole: req.user.role });
  }

  /** Give an advance or credit back as money. */
  @Post(':id/refund')
  @RequirePermission(Permission.POST_JOURNAL)
  refund(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: RefundDto) {
    return this.payments.refund(req.user.orgId, req.user.sub, id, body);
  }

  @Post(':id/apply')
  @RequirePermission(Permission.POST_JOURNAL)
  apply(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ApplyAdvanceDto) {
    return this.payments.applyAdvance(req.user.orgId, req.user.sub, id, body);
  }
}
