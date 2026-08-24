import { Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ComplianceStatus } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { ComplianceService } from './compliance.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

@Controller('crm/compliance')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /**
   * Deadlines grouped by obligation and period.
   * `from`/`to` filter on due date; omit both for everything on the calendar.
   */
  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: ComplianceStatus,
  ) {
    return this.compliance.listDeadlines({ from, to, status });
  }

  /**
   * Materialise the calendar for this firm's clients. Idempotent — the daily
   * sweep calls the same path, so running it by hand only fills gaps.
   */
  @Post('generate')
  generate(@Request() req: AuthRequest) {
    return this.compliance.generateForFirm(req.user.firmId!);
  }

  /**
   * Fire any reminders that are due today (7/3/1 days out). Already-reminded
   * items at the same offset are skipped, so this is safe to press twice.
   */
  @Post('run-reminders')
  runReminders(@Request() req: AuthRequest) {
    return this.compliance.runDueReminders(req.user.firmId!);
  }

  @Post('items/:id/file')
  markFiled(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.compliance.markFiled(id, req.user.sub);
  }
}
