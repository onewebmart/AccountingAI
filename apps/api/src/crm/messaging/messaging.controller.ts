import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { MessageChannel, MessageStatus, MessageTemplateKey } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { MessagingService } from './messaging.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class SendMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsEnum(MessageTemplateKey)
  templateKey: MessageTemplateKey;

  @IsString()
  @IsNotEmpty()
  recipientAddress: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  clientOrgId?: string;

  /** Template variables. Missing ones are rejected at render time, not sent raw. */
  @IsObject()
  variables: Record<string, string>;
}

@Controller('crm/messaging')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** The built-in template catalogue, for the settings screen. */
  @Get('templates')
  listTemplates() {
    return this.messaging.listTemplates();
  }

  /** Outbox — every message this firm has queued, sent or failed to send. */
  @Get('messages')
  listMessages(
    @Query('channel') channel?: MessageChannel,
    @Query('status') status?: MessageStatus,
    @Query('templateKey') templateKey?: MessageTemplateKey,
    @Query('limit') limit?: string,
  ) {
    return this.messaging.listMessages({
      channel,
      status,
      templateKey,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('messages/:id')
  getMessage(@Param('id') id: string) {
    return this.messaging.getMessage(id);
  }

  /**
   * Queue a message. Returns as soon as it is persisted and enqueued — the
   * provider call happens in the worker, so this never blocks on the network.
   */
  @Post('messages')
  send(@Request() req: AuthRequest, @Body() dto: SendMessageDto) {
    return this.messaging.enqueue({
      firmId: req.user.firmId!,
      channel: dto.channel,
      templateKey: dto.templateKey,
      variables: dto.variables,
      recipientAddress: dto.recipientAddress,
      recipientName: dto.recipientName,
      clientOrgId: dto.clientOrgId,
    });
  }
}
