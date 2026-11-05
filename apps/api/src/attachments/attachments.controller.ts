import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { memoryStorage } from 'multer';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AttachmentsService } from './attachments.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class AttachDto {
  @IsString()
  entityType: string;

  @IsMongoId()
  entityId: string;
}

class FromDocumentDto {
  @IsMongoId()
  documentId: string;

  @IsString()
  entityType: string;

  @IsMongoId()
  entityId: string;

  /** How the record reads: "Bill SGP/1342", "Expense EXP/2026-27/0009". */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  label?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_DOCUMENT)
  list(@Request() req: AuthRequest, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string) {
    // No record named: every file kept against any record, for the documents library.
    if (!entityType && !entityId) return this.attachments.listAll(req.user.orgId);
    return this.attachments.list(req.user.orgId, entityType ?? '', entityId ?? '');
  }

  @Post()
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  add(@Request() req: AuthRequest, @Body() body: AttachDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided.');
    return this.attachments.add(req.user.orgId, req.user.sub, { ...body, fileName: file.originalname, mimeType: file.mimetype, buffer: file.buffer });
  }

  /** "Add to": keep the scanned document against the record entered from it, and close its proposal. */
  @Post('from-document')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  fromDocument(@Request() req: AuthRequest, @Body() body: FromDocumentDto) {
    return this.attachments.fromDocument(req.user.orgId, req.user.sub, { ...body, label: body.label ?? '' });
  }

  @Get(':id/url')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  url(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.attachments.url(req.user.orgId, id);
  }

  @Delete(':id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  remove(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.attachments.remove(req.user.orgId, req.user.sub, id);
  }
}
