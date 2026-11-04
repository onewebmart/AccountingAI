import { Body, Controller, Get, Param, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsISO8601, IsMongoId, IsOptional, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PaymentRunsService } from './payment-runs.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

class SuggestRunDto {
  @IsISO8601({}, { message: 'payOn must be a date like 2026-10-31' })
  payOn: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cashLimitPaise?: number;
}

class RunItemDto {
  @IsMongoId()
  billId: string;

  @IsInt({ message: 'amountPaise must be whole paise' })
  @Min(1)
  amountPaise: number;
}

class CreateRunDto {
  @IsISO8601({}, { message: 'payOn must be a date like 2026-10-31' })
  payOn: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RunItemDto)
  items: RunItemDto[];
}

class MarkPaidDto {
  @IsISO8601({}, { message: 'paidOn must be a date like 2026-10-31' })
  paidOn: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('payments/runs')
export class PaymentRunsController {
  constructor(private readonly runs: PaymentRunsService) {}

  @Get()
  @RequirePermission(Permission.MANAGE_PURCHASE)
  list(@Request() req: AuthRequest) {
    return this.runs.list(req.user.orgId);
  }

  /** Which bills to pay by a date, ranked. Changes nothing. */
  @Post('suggest')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  suggest(@Request() req: AuthRequest, @Body() body: SuggestRunDto) {
    return this.runs.suggest(req.user.orgId, body);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_PURCHASE)
  create(@Request() req: AuthRequest, @Body() body: CreateRunDto) {
    return this.runs.create(req.user.orgId, req.user.sub, body);
  }

  /** The bank's bulk-payment file. */
  @Get(':id/bank-file')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  async bankFile(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.runs.bankFile(req.user.orgId, req.user.sub, id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  /** The bank has paid it: post the payments. */
  @Post(':id/paid')
  @RequirePermission(Permission.POST_JOURNAL)
  markPaid(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: MarkPaidDto) {
    return this.runs.markPaid(req.user.orgId, req.user.sub, id, body.paidOn, { actorRole: req.user.role });
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.MANAGE_PURCHASE)
  cancel(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.runs.cancel(req.user.orgId, req.user.sub, id);
  }
}
