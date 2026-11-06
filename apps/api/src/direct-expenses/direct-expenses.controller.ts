import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { DirectExpensesService } from './direct-expenses.service';
import { GST_SLABS, MAX_BULK, MAX_DISTANCE, MAX_LINES, MILEAGE_UNITS, MileageUnit } from './expense-lines';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One account of an itemized expense. */
export class ExpenseLineDto {
  @IsMongoId({ message: 'Pick the expense account on each line.' }) expenseAccountId: string;
  @IsInt({ message: 'amountPaise must be whole paise' }) @Min(1) amountPaise: number;
  @IsOptional() @IsIn([...GST_SLABS]) gstRatePct?: number;
  @IsOptional() @IsString() @Length(0, 300) description?: string | null;
}

/** A mileage expense: the distance, and the rate when it is not the preferences' one. */
export class MileageDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'The distance has up to two decimals.' }) @Min(0.01) @Max(MAX_DISTANCE) distance: number;
  @IsOptional() @IsIn([...MILEAGE_UNITS]) unit?: MileageUnit;
  @IsOptional() @IsInt({ message: 'ratePaise must be whole paise' }) @Min(1) ratePaise?: number | null;
  @IsOptional() @IsString() @Length(0, 120) employeeName?: string | null;
}

export class DirectExpenseDto {
  @Matches(DATE, { message: 'date must be a date like 2026-11-04' }) date: string;
  @IsOptional() @IsIn(['expense', 'mileage']) kind?: 'expense' | 'mileage';
  @IsOptional() @IsMongoId() vendorId?: string | null;
  /** One account and amount; or lines; a mileage expense may leave it to the preferences. */
  @IsOptional() @IsMongoId({ message: 'Pick the expense account.' }) expenseAccountId?: string | null;
  @IsMongoId({ message: 'Pick the bank or cash account it was paid from.' }) paidThroughAccountId: string;
  @IsOptional() @IsInt({ message: 'taxablePaise must be whole paise' }) @Min(1) taxablePaise?: number | null;
  @IsOptional() @IsIn([...GST_SLABS]) gstRatePct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_LINES) @ValidateNested({ each: true }) @Type(() => ExpenseLineDto) lines?: ExpenseLineDto[] | null;
  @IsOptional() @ValidateNested() @Type(() => MileageDto) mileage?: MileageDto | null;
  @IsOptional() @IsBoolean() interState?: boolean;
  @IsOptional() @IsBoolean() claimable?: boolean;
  @IsOptional() @IsString() @Length(0, 15) vendorGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 120) reference?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsMongoId() projectId?: string | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
}

/** Changing a draft: only the fields sent change. Its kind stays. */
export class UpdateDirectExpenseDto {
  @IsOptional() @Matches(DATE, { message: 'date must be a date like 2026-11-04' }) date?: string;
  @IsOptional() @IsMongoId() vendorId?: string | null;
  @IsOptional() @IsMongoId() expenseAccountId?: string;
  @IsOptional() @IsMongoId() paidThroughAccountId?: string;
  @IsOptional() @IsInt({ message: 'taxablePaise must be whole paise' }) @Min(1) taxablePaise?: number;
  @IsOptional() @IsIn([...GST_SLABS]) gstRatePct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_LINES) @ValidateNested({ each: true }) @Type(() => ExpenseLineDto) lines?: ExpenseLineDto[] | null;
  @IsOptional() @ValidateNested() @Type(() => MileageDto) mileage?: MileageDto | null;
  @IsOptional() @IsBoolean() interState?: boolean;
  @IsOptional() @IsBoolean() claimable?: boolean;
  @IsOptional() @IsString() @Length(0, 15) vendorGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 120) reference?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsMongoId() projectId?: string | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
}

/**
 * Bulk add. Each row is checked by the service, as a single expense is, so a
 * bad row comes back with its row number and reason rather than as a
 * class-validator path.
 */
export class BulkExpensesDto {
  @IsArray() @Type(() => Object) @ArrayMinSize(1, { message: 'Add at least one expense.' }) @ArrayMaxSize(MAX_BULK, { message: `At most ${MAX_BULK} expenses at a time.` }) expenses: Array<Record<string, unknown>>;
  @IsOptional() @IsBoolean() post?: boolean;
}

class MileageRateDto {
  @Matches(DATE, { message: 'A rate starts on a date like 2026-04-01' }) startDate: string;
  @IsInt({ message: 'ratePaise must be whole paise' }) @Min(1) ratePaise: number;
}

export class MileageSettingsDto {
  @IsOptional() @IsMongoId() defaultAccountId?: string | null;
  @IsIn([...MILEAGE_UNITS]) unit: MileageUnit;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MileageRateDto) rates: MileageRateDto[];
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
  list(@Request() req: AuthRequest, @Query('status') status?: string, @Query('q') q?: string, @Query('billable') billable?: string, @Query('customerId') customerId?: string) {
    return this.expenses.list(req.user.orgId, { status: status === 'draft' || status === 'posted' ? status : undefined, q, billable: billable === 'true', customerId: customerId || undefined });
  }

  /** The bank and cash accounts an expense can be paid from. */
  @Get('paid-through-accounts')
  @RequirePermission(Permission.VIEW_REPORTS)
  paidThrough(@Request() req: AuthRequest) {
    return this.expenses.paidThroughAccounts(req.user.orgId);
  }

  /** The mileage preferences: anyone recording an expense reads them. */
  @Get('mileage-settings')
  @RequirePermission(Permission.VIEW_REPORTS)
  mileageSettings(@Request() req: AuthRequest) {
    return this.expenses.mileageSettings(req.user.orgId);
  }

  /** Changing them is a settings change, as the expense-claim rules are. */
  @Put('mileage-settings')
  @RequirePermission(Permission.MANAGE_ORG)
  setMileageSettings(@Request() req: AuthRequest, @Body() body: MileageSettingsDto) {
    return this.expenses.setMileageSettings(req.user.orgId, req.user.sub, body);
  }

  /** Billable expenses not yet invoiced, for one customer or all. */
  @Get('billable')
  @RequirePermission(Permission.VIEW_REPORTS)
  billable(@Request() req: AuthRequest, @Query('customerId') customerId?: string) {
    return this.expenses.billable(req.user.orgId, customerId || undefined);
  }

  /** Save many at once: all or none. Posting them too needs posting rights. */
  @Post('bulk')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  bulk(@Request() req: AuthRequest, @Body() body: BulkExpensesDto) {
    if (body.post && !hasPermission(req.user.role as UserRole, Permission.POST_JOURNAL)) {
      throw new ForbiddenException('Your role can save expenses but not post them. Save them, and someone who posts can post each one.');
    }
    return this.expenses.bulk(req.user.orgId, req.user.sub, req.user.role, body.expenses, !!body.post);
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
