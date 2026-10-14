import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { InsightsService } from './insights.service';
import { financialYearOf } from '../gl/posting.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

@Controller('insights')
@UseGuards(AuthGuard('jwt'))
@RequirePermission(Permission.VIEW_REPORTS)
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

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
