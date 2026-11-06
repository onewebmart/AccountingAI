import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsMongoId, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { CurrentUser, JwtPayload, RequirePermission } from '../auth/decorators';
import { DocumentLibraryService } from './document-library.service';

class FolderNameDto {
  @IsString()
  @Length(1, 80)
  name: string;
}

class MoveItemDto {
  @IsIn(['document', 'attachment'])
  kind: 'document' | 'attachment';

  @IsMongoId()
  id: string;
}

class MoveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MoveItemDto)
  items: MoveItemDto[];

  /** The folder to file them in; null or left out for no folder. */
  @IsOptional()
  @IsMongoId()
  folderId?: string | null;
}

/**
 * The Documents area: every file with what it became, folders, the bank
 * statements that came in, and the reading pipeline for the dashboard.
 *
 * Listed before DocumentsController in DocumentsModule: its GET /documents/:id
 * would otherwise take /documents/library, /pipeline, /statements and /folders.
 */
@Controller('documents')
export class DocumentLibraryController {
  constructor(private readonly library: DocumentLibraryService) {}

  /** Uploads and attached files, newest first. folderId: a folder, or 'none' for files in no folder. */
  @Get('library')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  async list(@CurrentUser() user: JwtPayload, @Query('folderId') folderId?: string, @Query('limit') limit?: string) {
    const { data, truncated } = await this.library.library(user.orgId, { folderId: folderId || null, limit: limit ? Number(limit) || undefined : undefined });
    return { data, total: data.length, truncated };
  }

  @Get('pipeline')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  pipeline(@CurrentUser() user: JwtPayload) {
    return this.library.pipeline(user.orgId);
  }

  @Get('statements')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  statements(@CurrentUser() user: JwtPayload) {
    return this.library.statements(user.orgId);
  }

  @Get('folders')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  folders(@CurrentUser() user: JwtPayload) {
    return this.library.listFolders(user.orgId);
  }

  @Post('folders')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  createFolder(@CurrentUser() user: JwtPayload, @Body() body: FolderNameDto) {
    return this.library.createFolder(user.orgId, user.sub, body.name);
  }

  @Patch('folders/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  renameFolder(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: FolderNameDto) {
    return this.library.renameFolder(user.orgId, user.sub, id, body.name);
  }

  /** Its files move to no folder; the files stay. */
  @Delete('folders/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  deleteFolder(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.library.deleteFolder(user.orgId, user.sub, id);
  }

  /** File uploads and attached files in a folder, or in none. */
  @Post('move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  move(@CurrentUser() user: JwtPayload, @Body() body: MoveDto) {
    return this.library.move(user.orgId, user.sub, body.items, body.folderId ?? null);
  }
}
