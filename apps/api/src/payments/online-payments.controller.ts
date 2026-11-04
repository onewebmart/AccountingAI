import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, RawBodyRequest, Req, Request, UseGuards } from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';
import { Request as ExpressRequest } from 'express';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { Public, RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { OnlinePaymentsService } from './online-payments.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: UserRole };
}

class ConfirmDto {
  /** Defaults to the day the gateway says it was paid. */
  @IsOptional()
  @IsISO8601({}, { message: 'date must be a date like 2026-10-14' })
  date?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('payments/online')
export class OnlinePaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Get('gateway')
  @RequirePermission(Permission.MANAGE_SALES)
  gateway() {
    return this.online.gateway;
  }

  @Post(':invoiceId/link')
  @RequirePermission(Permission.MANAGE_SALES)
  createLink(@Request() req: AuthRequest, @Param('invoiceId') invoiceId: string) {
    return this.online.createLink(req.user.orgId, req.user.sub, invoiceId);
  }

  /** Book what the gateway reported as a receipt. Posts. */
  @Post(':invoiceId/confirm')
  @RequirePermission(Permission.POST_JOURNAL)
  confirm(@Request() req: AuthRequest, @Param('invoiceId') invoiceId: string, @Body() body: ConfirmDto) {
    if (!hasPermission(req.user.role, Permission.MANAGE_SALES)) throw new ForbiddenException('You need sales rights to record this.');
    return this.online.confirm(req.user.orgId, req.user.sub, invoiceId, body.date);
  }

  /** Test gateway only: play the customer paying. */
  @Post(':invoiceId/mock-pay')
  @RequirePermission(Permission.MANAGE_SALES)
  payMock(@Request() req: AuthRequest, @Param('invoiceId') invoiceId: string) {
    return this.online.payMock(req.user.orgId, invoiceId);
  }
}

/**
 * Callbacks from the payment gateway. Public: there is no user. Trusted only
 * when the signature over the raw body matches; marks an invoice paid
 * online and posts nothing.
 */
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Public()
  @Post('razorpay')
  razorpay(@Req() req: RawBodyRequest<ExpressRequest>, @Headers('x-razorpay-signature') signature?: string) {
    return this.online.handleWebhook(req.rawBody, signature);
  }
}
