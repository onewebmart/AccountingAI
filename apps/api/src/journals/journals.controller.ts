import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload } from '../auth/decorators';

/**
 * Journals controller — Phase 3 stub.
 * Full double-entry implementation lands in Phase 4 (GL backbone).
 * This stub exists to demonstrate and test RBAC enforcement:
 *   POST /journals requires journal:post permission (Employee role is blocked).
 */
@Controller('journals')
export class JournalsController {
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(Permission.POST_JOURNAL)
  postJournal(@CurrentUser() _user: JwtPayload) {
    // Phase 4 will replace this stub with real double-entry logic
    return { message: 'Journal posting stub — Phase 4 will implement this.' };
  }

  @Get()
  @RequirePermission(Permission.VIEW_JOURNAL)
  listJournals(@CurrentUser() _user: JwtPayload) {
    return { data: [], total: 0 };
  }
}
