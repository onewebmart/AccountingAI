import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';
import { CurrentUser, JwtPayload, RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { DocumentEntryService } from './document-entry.service';

/** "Add to": a form filled from a scanned document, for a person to check and save. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('documents')
export class DocumentEntryController {
  constructor(private readonly entry: DocumentEntryService) {}

  @Get(':id/extraction')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  extraction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.entry.extraction(user.orgId, id);
  }
}
