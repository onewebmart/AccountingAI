import { Controller, Get, Post, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReconciliationService } from './reconciliation.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

// Request bodies are validated: these used to be bare interfaces, so a float or
// a string for an amount went straight into the bank lines.

class CreateBankAccountDto {
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() ifsc?: string;
  @IsOptional() @IsInt({ message: 'openingBalancePaise must be an integer number of paise' }) openingBalancePaise?: number;
  @IsOptional() @IsISO8601() openingBalanceDate?: string;
}

class StatementLineDto {
  @IsISO8601({}, { message: 'date must be a date like 2026-10-10' }) date: string;
  @IsString() @Length(1, 500) description: string;
  @IsOptional() @IsString() reference?: string;
  @IsInt({ message: 'debitPaise must be an integer number of paise' }) @Min(0) debitPaise: number;
  @IsInt({ message: 'creditPaise must be an integer number of paise' }) @Min(0) creditPaise: number;
  @IsOptional() @IsInt() runningBalancePaise?: number;
}

class ImportStatementDto {
  @IsMongoId() bankAccountId: string;
  @IsISO8601() periodStart: string;
  @IsISO8601() periodEnd: string;
  @IsInt() openingBalancePaise: number;
  @IsInt() closingBalancePaise: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => StatementLineDto) lines: StatementLineDto[];
}

class ManualMatchDto {
  @IsOptional() @IsMongoId() journalId?: string;
  @IsOptional() @IsMongoId() invoiceId?: string;
  @IsOptional() @IsMongoId() billId?: string;
}

class ExcludeLineDto {
  @IsBoolean() excluded: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('banking')
export class BankingController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('accounts')
  @RequirePermission(Permission.VIEW_JOURNAL)
  listAccounts(@Request() req: AuthRequest) {
    return this.reconciliationService.listAccounts(req.user.orgId);
  }

  @Post('accounts')
  @RequirePermission(Permission.POST_JOURNAL)
  createAccount(@Request() req: AuthRequest, @Body() body: CreateBankAccountDto) {
    return this.reconciliationService.createAccount({ ...body, orgId: req.user.orgId, actorId: req.user.sub });
  }

  @Get('statements')
  @RequirePermission(Permission.VIEW_JOURNAL)
  listStatements(@Request() req: AuthRequest, @Query('bankAccountId') bankAccountId?: string) {
    return this.reconciliationService.listStatements(req.user.orgId, bankAccountId);
  }

  @Post('statements')
  @RequirePermission(Permission.POST_JOURNAL)
  importStatement(@Request() req: AuthRequest, @Body() body: ImportStatementDto) {
    return this.reconciliationService.importStatement({ ...body, orgId: req.user.orgId, actorId: req.user.sub });
  }

  @Get('statements/:id/report')
  @RequirePermission(Permission.VIEW_JOURNAL)
  getReport(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.getDiffReport(id, req.user.orgId);
  }

  /** "Run reconciliation" — suggests matches; posts nothing. */
  @Post('statements/:id/auto-match')
  @RequirePermission(Permission.POST_JOURNAL)
  autoMatch(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.autoMatch(id, req.user.orgId, req.user.sub);
  }

  /** "Confirm matches" — the human step that posts receipts and payments for matched invoices and bills. */
  @Post('statements/:id/confirm')
  @RequirePermission(Permission.POST_JOURNAL)
  confirmMatches(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.confirmMatches(id, req.user.orgId, req.user.sub);
  }

  @Post('lines/:lineId/match')
  @RequirePermission(Permission.POST_JOURNAL)
  manualMatch(@Request() req: AuthRequest, @Param('lineId') lineId: string, @Body() body: ManualMatchDto) {
    return this.reconciliationService.manualMatch(lineId, body, req.user.orgId, req.user.sub);
  }

  @Post('lines/:lineId/unmatch')
  @RequirePermission(Permission.POST_JOURNAL)
  unmatch(@Request() req: AuthRequest, @Param('lineId') lineId: string) {
    return this.reconciliationService.unmatch(lineId, req.user.orgId, req.user.sub);
  }

  @Post('lines/:lineId/exclude')
  @RequirePermission(Permission.POST_JOURNAL)
  exclude(@Request() req: AuthRequest, @Param('lineId') lineId: string, @Body() body: ExcludeLineDto) {
    return this.reconciliationService.setExcluded(lineId, body.excluded, req.user.orgId, req.user.sub);
  }

  @Post('lines/:lineId/not-duplicate')
  @RequirePermission(Permission.POST_JOURNAL)
  notDuplicate(@Request() req: AuthRequest, @Param('lineId') lineId: string) {
    return this.reconciliationService.clearDuplicateFlag(lineId, req.user.orgId, req.user.sub);
  }
}
