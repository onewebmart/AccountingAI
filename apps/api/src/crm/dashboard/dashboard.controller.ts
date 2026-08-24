import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { DashboardService } from './dashboard.service';
import { CrmReportsService } from './crm-reports.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

@Controller('crm')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reports: CrmReportsService,
  ) {}

  /** Every tile on the CRM landing page, in one call. */
  @Get('dashboard')
  summary(@Request() req: AuthRequest) {
    return this.dashboard.summary(req.user.firmId!);
  }

  @Get('reports')
  reports_(@Request() req: AuthRequest, @Query('months') months?: string) {
    const window = months ? Math.min(24, Math.max(1, Number(months))) : 6;
    return this.reports.build(req.user.firmId!, undefined, window);
  }
}
