import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { DocumentRequestStatus, FirmService } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { DocumentRequestService, progressOf } from './document-request.service';
import { DocumentRequestDocument } from '../schemas/document-request.schema';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class CreateRequestDto {
  @IsString()
  clientOrgId: string;

  @IsEnum(FirmService)
  service: FirmService;

  @IsISO8601()
  dueDate: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  complianceItemId?: string;
}

export class AttachDocumentDto {
  @IsString()
  documentId: string;

  @IsString()
  documentName: string;
}

export class RemindDto {
  /** Omit to chase every open request. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requestIds?: string[];
}

/** Adds the computed progress the collection board renders. */
function withProgress(request: DocumentRequestDocument) {
  return { ...request.toObject(), progress: progressOf(request) };
}

@Controller('crm/document-requests')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class DocumentRequestController {
  constructor(private readonly requests: DocumentRequestService) {}

  @Get()
  async list(@Query('status') status?: DocumentRequestStatus) {
    const requests = await this.requests.list({ status });
    return requests.map(withProgress);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return withProgress(await this.requests.findById(id));
  }

  @Post()
  async create(@Request() req: AuthRequest, @Body() dto: CreateRequestDto) {
    const created = await this.requests.create({
      firmId: req.user.firmId!,
      clientOrgId: dto.clientOrgId,
      service: dto.service,
      dueDate: dto.dueDate,
      purpose: dto.purpose,
      complianceItemId: dto.complianceItemId,
    });
    return withProgress(created);
  }

  /** Link an upload to a checklist item by hand. */
  @Post(':id/items/:key/attach')
  async attach(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: AttachDocumentDto,
  ) {
    const updated = await this.requests.attachDocument(id, key, dto.documentId, dto.documentName, {
      autoMatched: false,
      actorId: req.user.sub,
    });
    return withProgress(updated);
  }

  /** Human confirmation that a received document is the right one. */
  @Post(':id/items/:key/verify')
  async verify(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Param('key') key: string,
  ) {
    return withProgress(await this.requests.verifyItem(id, key, req.user.sub));
  }

  /** Chase outstanding documents — all open requests, or just the ones named. */
  @Post('remind')
  remind(@Request() req: AuthRequest, @Body() dto: RemindDto) {
    return this.requests.sendReminders(req.user.firmId!, dto.requestIds);
  }
}
