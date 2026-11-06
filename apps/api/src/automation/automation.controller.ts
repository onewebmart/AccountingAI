import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsMongoId,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RecurringService } from './recurring.service';
import { RemindersService } from './reminders.service';
import { RecurringKind } from './schemas/recurring-template.schema';
import { FREQUENCIES, Frequency } from './schedule';
import { AdjustmentDto, DiscountDto } from '../orders/doc-extras.dto';
import { ExpenseLineDto } from '../direct-expenses/direct-expenses.controller';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class AmountsDto {
  @IsInt() @Min(0) taxableValue: number;
  @IsInt() @Min(0) cgst: number;
  @IsInt() @Min(0) sgst: number;
  @IsInt() @Min(0) igst: number;
  @IsInt() @Min(0) cess: number;
  @IsInt() @Min(1) total: number;
}

class LineDto {
  @IsString() @Length(1, 300) description: string;
  @IsOptional() @IsString() hsnSac?: string | null;
  /** Invoices take up to three decimals (2.5 kg); bills whole units, as before. */
  @IsOptional() @IsNumber() @Min(0) qty?: number;
  @IsInt() @Min(0) ratePaise: number;
  @IsInt() @Min(0) amountPaise: number;
  @IsOptional() @Min(0) @Max(100) taxRatePct?: number;
  @IsOptional() @IsMongoId() itemId?: string | null;
  @IsOptional() @IsString() @Length(0, 3) uqc?: string | null;
  /** Bills: the account the line is booked to, its own discount, and the customer it is for. */
  @IsOptional() @IsMongoId() accountId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
}

class CreateRecurringDto {
  @IsString() @Length(1, 120) name: string;
  @IsString() partyId: string;
  @IsIn([...FREQUENCIES]) frequency: Frequency;
  @IsInt() @Min(1) @Max(31) dayOfMonth: number;
  @Matches(DATE, { message: 'startDate must be a date like 2026-10-01' }) startDate: string;
  @IsOptional() @Matches(DATE, { message: 'endDate must be a date like 2027-03-31' }) endDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) dueInDays?: number;
  @ValidateNested() @Type(() => AmountsDto) amountsPaise: AmountsDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineDto) lineItems?: LineDto[];
  @IsOptional() @IsBoolean() isReverseCharge?: boolean;
  @IsOptional() @IsString() @Length(0, 500) notes?: string | null;
  /** Invoices: the order number, subject, salesperson and terms each draft carries; the discount and adjustment it is priced with. */
  @IsOptional() @IsString() @Length(0, 60) referenceNumber?: string | null;
  @IsOptional() @IsString() @Length(0, 250) subject?: string | null;
  @IsOptional() @IsString() @Length(0, 80) salespersonName?: string | null;
  @IsOptional() @IsString() @Length(0, 3000) termsAndConditions?: string | null;
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @ValidateNested() @Type(() => AdjustmentDto) adjustment?: AdjustmentDto | null;
  /** Bills: the terms each bill is due by. */
  @IsOptional() @IsString() @Matches(/^(due_on_receipt|net_\d{1,3}|end_of_month|end_of_next_month)$/, { message: 'paymentTerms is due_on_receipt, net_<days>, end_of_month or end_of_next_month' }) paymentTerms?: string | null;
}

class ReminderSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['auto', 'email', 'whatsapp']) channel?: 'auto' | 'email' | 'whatsapp';
}

/** Recurring bills need purchase rights; recurring invoices, sales rights. */
class JournalLineDto {
  @IsMongoId() accountId: string;
  @IsInt() @Min(0) debitPaise: number;
  @IsInt() @Min(0) creditPaise: number;
}

class CreateRecurringJournalDto {
  @IsString() @Length(1, 120) name: string;
  @IsIn([...FREQUENCIES]) frequency: Frequency;
  @IsInt() @Min(1) @Max(31) dayOfMonth: number;
  @Matches(DATE, { message: 'startDate must be a date like 2026-10-01' }) startDate: string;
  @IsOptional() @Matches(DATE, { message: 'endDate must be a date like 2027-03-31' }) endDate?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto) journalLines: JournalLineDto[];
  @IsOptional() @IsString() @Length(0, 500) notes?: string | null;
}

/** An expense paid from bank or cash each period, drafted for a person to post. */
class CreateRecurringExpenseDto {
  @IsString() @Length(1, 120) name: string;
  /** The vendor paid, when they are one in the books. */
  @IsOptional() @IsMongoId() partyId?: string;
  @IsIn([...FREQUENCIES]) frequency: Frequency;
  @IsInt() @Min(1) @Max(31) dayOfMonth: number;
  @Matches(DATE, { message: 'startDate must be a date like 2026-10-01' }) startDate: string;
  @IsOptional() @Matches(DATE, { message: 'endDate must be a date like 2027-03-31' }) endDate?: string | null;
  /** One account and amount; or lines, for an itemized expense (checked by the expenses service). */
  @IsOptional() @IsMongoId({ message: 'Pick the expense account.' }) expenseAccountId?: string | null;
  @IsMongoId({ message: 'Pick the bank or cash account it is paid from.' }) paidThroughAccountId: string;
  @IsOptional() @IsInt({ message: 'taxablePaise must be whole paise' }) @Min(1) taxablePaise?: number | null;
  @IsOptional() @IsIn([0, 3, 5, 12, 18, 28, 40]) gstRatePct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ExpenseLineDto) lines?: ExpenseLineDto[] | null;
  @IsOptional() @IsBoolean() interState?: boolean;
  @IsOptional() @IsBoolean() claimable?: boolean;
  @IsOptional() @IsString() @Length(0, 15) vendorGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 120) reference?: string | null;
  @IsOptional() @IsMongoId() projectId?: string | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @Length(0, 500) notes?: string | null;
}

const RIGHT: Record<RecurringKind, Permission> = {
  bill: Permission.MANAGE_PURCHASE,
  invoice: Permission.MANAGE_SALES,
  // A recurring journal is drafted for review; making one is a poster's call.
  journal: Permission.POST_JOURNAL,
  // A recurring expense drafts; posting it still needs posting rights.
  expense: Permission.MANAGE_PURCHASE,
};

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class AutomationController {
  constructor(
    private readonly recurring: RecurringService,
    private readonly reminders: RemindersService,
  ) {}

  // ── Recurring ─────────────────────────────────────────────────────────────

  @Get('recurring')
  @RequirePermission(Permission.VIEW_REPORTS)
  list(@Request() req: AuthRequest) {
    return this.recurring.list(req.user.orgId);
  }

  @Post('recurring/bills')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  createBill(@Request() req: AuthRequest, @Body() body: CreateRecurringDto) {
    return this.recurring.create(req.user.orgId, req.user.sub, { ...body, kind: 'bill' });
  }

  @Post('recurring/invoices')
  @RequirePermission(Permission.MANAGE_SALES)
  createInvoice(@Request() req: AuthRequest, @Body() body: CreateRecurringDto) {
    return this.recurring.create(req.user.orgId, req.user.sub, { ...body, kind: 'invoice' });
  }

  @Post('recurring/journals')
  @RequirePermission(Permission.POST_JOURNAL)
  createJournal(@Request() req: AuthRequest, @Body() body: CreateRecurringJournalDto) {
    return this.recurring.create(req.user.orgId, req.user.sub, { ...body, kind: 'journal' });
  }

  @Post('recurring/expenses')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  createExpense(@Request() req: AuthRequest, @Body() body: CreateRecurringExpenseDto) {
    const { expenseAccountId, paidThroughAccountId, taxablePaise, gstRatePct, lines, interState, claimable, vendorGstin, reference, projectId, customerId, billable, ...rest } = body;
    return this.recurring.create(req.user.orgId, req.user.sub, {
      ...rest,
      kind: 'expense',
      expense: { expenseAccountId, paidThroughAccountId, taxablePaise, gstRatePct, lines, interState, claimable, vendorGstin, reference, projectId, customerId, billable },
    });
  }

  /** Pause, resume or end. Checked against the template's own kind. */
  @Post('recurring/:id/:action')
  @RequirePermission(Permission.VIEW_REPORTS)
  async setStatus(@Request() req: AuthRequest, @Param('id') id: string, @Param('action') action: string) {
    const status = ({ pause: 'paused', resume: 'active', end: 'ended' } as const)[action as 'pause' | 'resume' | 'end'];
    if (!status) throw new ForbiddenException('Use pause, resume or end.');
    const kind = await this.recurring.kindOf(req.user.orgId, id);
    this.require(req, RIGHT[kind]);
    return this.recurring.setStatus(req.user.orgId, id, req.user.sub, status);
  }

  /** Draft whatever is due now rather than waiting for the morning run. */
  @Post('recurring-run')
  @RequirePermission(Permission.VIEW_REPORTS)
  run(@Request() req: AuthRequest) {
    const kinds = (['bill', 'invoice', 'journal', 'expense'] as const).filter((k) => hasPermission(req.user.role as UserRole, RIGHT[k]));
    if (kinds.length === 0) throw new ForbiddenException('Your role cannot create bills or invoices.');
    return this.recurring.runDue(req.user.orgId, undefined, req.user.sub, [...kinds]);
  }

  // ── Payment reminders ─────────────────────────────────────────────────────

  @Get('reminders/settings')
  @RequirePermission(Permission.VIEW_REPORTS)
  settings(@Request() req: AuthRequest) {
    return this.reminders.settings(req.user.orgId);
  }

  @Patch('reminders/settings')
  @RequirePermission(Permission.MANAGE_SALES)
  updateSettings(@Request() req: AuthRequest, @Body() body: ReminderSettingsDto) {
    return this.reminders.updateSettings(req.user.orgId, req.user.sub, body);
  }

  @Get('reminders')
  @RequirePermission(Permission.MANAGE_SALES)
  listReminders(@Request() req: AuthRequest, @Query('invoiceId') invoiceId?: string) {
    return this.reminders.list(req.user.orgId, invoiceId);
  }

  /** Run today's ladder now. */
  @Post('reminders/run')
  @RequirePermission(Permission.MANAGE_SALES)
  runReminders(@Request() req: AuthRequest) {
    return this.reminders.runDue(req.user.orgId);
  }

  /** Chase one invoice now. */
  @Post('reminders/invoices/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  remind(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reminders.sendNow(req.user.orgId, id, req.user.sub);
  }

  private require(req: AuthRequest, permission: Permission) {
    if (!hasPermission(req.user.role as UserRole, permission)) {
      throw new ForbiddenException(`Your role (${req.user.role}) does not have permission to perform this action.`);
    }
  }
}
