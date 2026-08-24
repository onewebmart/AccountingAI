import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FirmAdminGuard } from './white-label.guard';
import { WhiteLabelService, UpdateWhiteLabelDto } from './white-label.service';
import { AddClientDto } from './dto/client.dto';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

@Controller('firm')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class WhiteLabelController {
  constructor(private readonly whiteLabelService: WhiteLabelService) {}

  // ── White-label config ────────────────────────────────────────────────────────

  @Get('config')
  getConfig(@Request() req: AuthRequest) {
    return this.whiteLabelService.getWhiteLabelConfig(req.user.firmId!);
  }

  @Patch('config')
  updateConfig(
    @Request() req: AuthRequest,
    @Body() dto: UpdateWhiteLabelDto,
  ) {
    return this.whiteLabelService.updateWhiteLabelConfig(req.user.firmId!, dto, req.user.sub);
  }

  /** Resolve a custom domain to a firm (used by the portal entry route). */
  @Get('resolve-domain')
  resolveDomain(@Query('domain') domain: string) {
    return this.whiteLabelService.resolveByDomain(domain);
  }

  // ── Client management ─────────────────────────────────────────────────────────

  @Get('clients')
  getClients(@Request() req: AuthRequest) {
    return this.whiteLabelService.getClients(req.user.firmId!);
  }

  @Post('clients')
  addClient(
    @Request() req: AuthRequest,
    @Body() dto: AddClientDto,
  ) {
    return this.whiteLabelService.addClient(req.user.firmId!, dto, req.user.sub);
  }

  @Get('clients/summaries')
  getClientSummaries(@Request() req: AuthRequest) {
    return this.whiteLabelService.getClientSummaries(req.user.firmId!);
  }

  @Get('clients/:orgId/summary')
  async getClientSummary(
    @Request() req: AuthRequest,
    @Param('orgId') orgId: string,
  ) {
    const summaries = await this.whiteLabelService.getClientSummaries(req.user.firmId!);
    return summaries.find((s) => s.orgId === orgId) ?? null;
  }
}
