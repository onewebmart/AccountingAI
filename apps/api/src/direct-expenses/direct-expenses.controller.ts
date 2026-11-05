import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { DirectExpensesService, GST_SLABS } from './direct-expenses.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DirectExpenseDto {
  @Matches(DATE, { message: 'date must be a date like 2026-11-04' }) date: string;
  @IsOptional() @IsMongoId() vendorId?: string | null;
  @IsMongoId({ message: 'Pick the expense account.' }) expenseAccountId: string;
  @IsMongoId({ message: 'Pick the bank or cash account it was paid from.' }) paidThroughAccountId: string;
  @IsInt({ message: 'taxablePaise must be whole paise' }) @Min(1) taxablePaise: number;
  @IsOptional() @IsIn([...GST_SLABS]) gstRatePct?: number;
  @IsOptional() @IsBoolean() interState?: boolean;
  @IsOptional() @IsBoolean() claimable?: boolean;
  @IsOptional() @IsString() @Length(0, 15) vendorGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 120) reference?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsMongoId() projectId?: string | null;
}

/** Changing a draft: only the fields sent change. */
export class UpdateDirectExpenseDto {
  @IsOptional() @Matches(DATE, { message: 'date must be a date like 2026-11-04' }) date?: string;
  @IsOptional() @IsMongoId() vendorId?: string | null;
  @IsOptional() @IsMongoId() expenseAccountId?: string;
  @IsOptional() @IsMongoId() paidThroughAccountId?: string;
  @IsOptional() @IsInt({ message: 'taxablePaise must be whole paise' }) @Min(1) taxablePaise?: number;
  @IsOptional() @IsIn([...GST_SLABS]) gstRatePct?: number;
  @IsOptional() @IsBoolean() interState?: boolean;
  @IsOptional() @IsBoolean() claimable?: boolean;
  @IsOptional() @IsString() @Length(0, 15) vendorGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 120) reference?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsMongoId() projectId?: string | null;
}

/**
 * Expenses paid straight from bank or cash. Under /direct-expenses: the
 * employees' expense claims already live under /expense-claims.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('direct-expenses')
export class DirectExpensesController {
  constructor(private readonly expenses: DirectExpensesService) {}

  @Get()
  @RequirePermission(Permission.VIEW_REPORTS)
  list(@Request() req: AuthRequest, @Query('status') status?: string, @Query('q') q?: string) {
    return this.expenses.list(req.user.orgId, { status: status === 'draft' || status === 'posted' ? status : undefined, q });
  }

  /** The bank and cash accounts an expense can be paid from. */
  @Get('paid-through-accounts')
  @RequirePermission(Permission.VIEW_REPORTS)
  paidThrough(@Request() req: AuthRequest) {
    return this.expenses.paidThroughAccounts(req.user.orgId);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_REPORTS)
  get(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.expenses.get(req.user.orgId, id);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_PURCHASE)
  create(@Request() req: AuthRequest, @Body() body: DirectExpenseDto) {
    return this.expenses.create(req.user.orgId, req.user.sub, body);
  }

  @Patch(':id')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: UpdateDirectExpenseDto) {
    return this.expenses.update(req.user.orgId, req.user.sub, id, body);
  }

  /**
   * Post to the ledger: a payment voucher, under the payment approval policy.
   * Posting rights, as for bills: a CA reviewer manages purchases but does not post.
   */
  @Post(':id/post')
  @RequirePermission(Permission.POST_JOURNAL)
  post(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.expenses.post(req.user.orgId, req.user.sub, req.user.role, id);
  }
}
