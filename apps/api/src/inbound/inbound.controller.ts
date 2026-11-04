import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, RawBodyRequest, Req, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Request as ExpressRequest } from 'express';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Permission } from '@ai-accounting/shared';
import { Public, RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { InboundService } from './inbound.service';
import { parsePostmarkInbound } from './email-payload';
import { verifyMetaSignature } from './whatsapp';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

class PhoneDto {
  @IsString()
  @Length(10, 20)
  phone: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbound: InboundService) {}

  /** The org's address for forwarding bills to. */
  @Get('address')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  address(@Request() req: AuthRequest) {
    return this.inbound.emailAddress(req.user.orgId);
  }

  @Post('address/rotate')
  @RequirePermission(Permission.MANAGE_ORG)
  rotate(@Request() req: AuthRequest) {
    return this.inbound.rotate(req.user.orgId, req.user.sub);
  }

  @Get('whatsapp-senders')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  whatsappSenders(@Request() req: AuthRequest) {
    return this.inbound.whatsappSenders(req.user.orgId);
  }

  /** A code to send from the phone being linked. */
  @Post('whatsapp-senders/code')
  @RequirePermission(Permission.MANAGE_ORG)
  linkCode(@Request() req: AuthRequest) {
    return this.inbound.whatsappLinkCode(req.user.orgId, req.user.sub);
  }

  @Post('whatsapp-senders/remove')
  @RequirePermission(Permission.MANAGE_ORG)
  unlinkSender(@Request() req: AuthRequest, @Body() body: PhoneDto) {
    return this.inbound.unlinkWhatsappSender(req.user.orgId, req.user.sub, body.phone);
  }

  /** What was sent in, and what became of each file. */
  @Get('messages')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  messages(@Request() req: AuthRequest) {
    return this.inbound.list(req.user.orgId);
  }
}

/**
 * The mail provider's inbound webhook. Public: there is no user. Trusted only
 * with the shared secret, sent as the password of HTTP basic auth (as
 * Postmark sends it from https://inbound:SECRET@…) or as X-Inbound-Secret.
 */
@Controller('inbound')
export class InboundEmailController {
  constructor(
    private readonly inbound: InboundService,
    private readonly config: ConfigService,
  ) {}

  /** Meta's one-time check that we own the webhook URL. */
  @Public()
  @Get('whatsapp')
  verifyWhatsapp(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    const expected = this.config.get<string>('inbound.whatsappVerifyToken');
    if (mode !== 'subscribe' || !expected || !token || !same(token, expected)) throw new UnauthorizedException('Verification failed.');
    return challenge ?? '';
  }

  /** WhatsApp Cloud API messages, trusted only with Meta's signature over the raw body. */
  @Public()
  @Post('whatsapp')
  @HttpCode(200)
  async whatsapp(@Req() req: RawBodyRequest<ExpressRequest>, @Headers('x-hub-signature-256') signature?: string) {
    if (!this.inbound.whatsappConfigured) throw new BadRequestException('WhatsApp-in is not set up on this server (WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN).');
    if (!req.rawBody || !verifyMetaSignature(req.rawBody, signature, this.config.get<string>('inbound.whatsappAppSecret')!)) {
      throw new UnauthorizedException('The webhook signature does not match.');
    }
    return this.inbound.receiveWhatsapp(JSON.parse(req.rawBody.toString('utf8')));
  }

  @Public()
  @Post('email')
  @HttpCode(200)
  async email(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-inbound-secret') headerSecret?: string) {
    this.inbound.assertEmailConfigured();
    const secret = this.config.get<string>('inbound.emailSecret')!;
    const basic = authorization?.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':') : null;
    if (!(basic !== null && same(basic, secret)) && !(headerSecret && same(headerSecret, secret))) throw new UnauthorizedException('Unknown sender.');
    return this.inbound.receiveEmail(parsePostmarkInbound(body));
  }
}
