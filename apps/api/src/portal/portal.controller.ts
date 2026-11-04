import { Body, Controller, Get, Param, Post, Request, Res, UseGuards } from '@nestjs/common';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { Public, RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PortalService } from './portal.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class CreatePortalLinkDto {
  @IsMongoId()
  customerId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number;
}

class RevokePortalLinksDto {
  @IsMongoId()
  customerId: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('portal-links')
export class PortalLinksController {
  constructor(private readonly portal: PortalService) {}

  @Post()
  @RequirePermission(Permission.MANAGE_SALES)
  create(@Request() req: AuthRequest, @Body() body: CreatePortalLinkDto) {
    return this.portal.createLink(req.user.orgId, req.user.sub, body.customerId, body.days);
  }

  @Post('revoke')
  @RequirePermission(Permission.MANAGE_SALES)
  revoke(@Request() req: AuthRequest, @Body() body: RevokePortalLinksDto) {
    return this.portal.revoke(req.user.orgId, req.user.sub, body.customerId);
  }
}

/** The customer's side: no login, the link is the key. Read-only. */
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Public()
  @Get(':token')
  view(@Param('token') token: string) {
    return this.portal.view(token);
  }

  @Public()
  @Get(':token/invoices/:invoiceId/pdf')
  async pdf(@Param('token') token: string, @Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const { filename, content } = await this.portal.pdf(token, invoiceId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(content);
  }
}
