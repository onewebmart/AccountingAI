import { BadRequestException, Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { InsightsService } from './insights.service';
import { ForecastService } from './forecast.service';
import { financialYearOf } from '../gl/posting.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

@Controller('insights')
// The permission guard was missing, so @RequirePermission was never checked.
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.VIEW_REPORTS)
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly forecastService: ForecastService,
  ) {}

  /** Where cash is heading, week by week. */
  @Get('forecast')
  forecast(@Request() req: AuthRequest, @Query('weeks') weeks?: string) {
    const n = weeks === undefined ? 13 : Number(weeks);
    if (!Number.isInteger(n)) throw new BadRequestException('weeks must be a whole number');
    return this.forecastService.cashForecast(req.user.orgId, n);
  }

  /** The last six months of profit and loss, and the next three by trend. */
  @Get('projection')
  projection(@Request() req: AuthRequest) {
    return this.forecastService.plProjection(req.user.orgId);
  }

  @Get()
  async getInsights(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear?: string,
  ) {
    // Defaulted to a fixed '2025-26', so from April 2026 a request without a
    // year compared this month against a year it is not in and found nothing.
    const insights = await this.insightsService.getInsights(
      req.user.orgId,
      financialYear || financialYearOf(new Date().toISOString().slice(0, 10)),
    );
    return { insights };
  }
}
