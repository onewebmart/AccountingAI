import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Permission, DocumentStatus } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload, Public } from '../auth/decorators';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';
import { CONTENT_TYPES, MAX_SIZE_BYTES, isAcceptedFile, rejectionMessage } from './accepted-files';

function mimeTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

@Controller('documents')
export class DocumentsController {
  constructor(
    private docs: DocumentsService,
    private storage: StorageService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (isAcceptedFile(file.mimetype, file.originalname)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException(rejectionMessage(file.originalname, file.mimetype)), false);
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

  /** Re-run the pipeline on a document that failed. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  retry(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.docs.retryProcessing(id, user.orgId);
  }

  /**
   * Streams a locally-stored file for a signed, time-limited link. Public by
   * necessity — a browser cannot attach an Authorization header to an <img> or
   * <iframe> — so the HMAC signature is what authorises the read.
   */
  @Public()
  @Get('file')
  async streamLocalFile(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!key || !expires || !sig) throw new BadRequestException('Invalid file link.');
    if (!this.storage.verifySignature(key, Number(expires), sig)) {
      throw new UnauthorizedException('This file link has expired.');
    }

    const buffer = await this.storage.download(key);
    res.setHeader('Content-Type', mimeTypeForKey(key));
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
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
