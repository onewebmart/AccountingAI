import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Permission, DocumentStatus } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload } from '../auth/decorators';
import { DocumentsService } from './documents.service';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

@Controller('documents')
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`File type "${file.mimetype}" is not supported.`), false);
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided.');

    const doc = await this.docs.upload({
      orgId: user.orgId,
      uploadedBy: user.sub,
      originalName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    return {
      id: doc._id.toString(),
      originalName: doc.originalName,
      status: doc.status,
      sizeBytes: doc.sizeBytes,
      sha256: doc.sha256,
      duplicateOf: doc.duplicateOf?.toString(),
      jobId: doc.jobId,
    };
  }

  @Get()
  @RequirePermission(Permission.VIEW_DOCUMENT)
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: DocumentStatus,
  ) {
    const docs = await this.docs.findAll(user.orgId, status);
    return { data: docs, total: docs.length };
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  async getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const doc = await this.docs.findById(id, user.orgId);
    if (!doc) throw new BadRequestException('Document not found.');
    return doc;
  }

  @Get(':id/url')
  @RequirePermission(Permission.VIEW_DOCUMENT)
  async getPresignedUrl(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const url = await this.docs.getPresignedUrl(id, user.orgId);
    return { url };
  }
}
