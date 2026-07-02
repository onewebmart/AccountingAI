import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { InsightsService } from './insights.service';

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
    @Query('financialYear') financialYear: string = '2025-26',
  ) {
    const insights = await this.insightsService.getInsights(
      req.user.orgId,
      financialYear,
    );
    return { insights };
  }
}
