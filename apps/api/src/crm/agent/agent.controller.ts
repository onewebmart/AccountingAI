import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ConversationStatus, MessageChannel } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { ConversationsService } from './conversations.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class InboundMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  /** Sender's phone number or email. */
  @IsString()
  @Length(1, 200)
  from: string;

  @IsString()
  @Length(1, 4000)
  text: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  contactName?: string;
}

@Controller('crm/agent')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class AgentController {
  constructor(private readonly conversations: ConversationsService) {}

  /**
   * Inbound message hook.
   *
   * Guarded like every other firm route while the messaging adapter is mocked.
   * A real WhatsApp Business webhook authenticates differently — by provider
   * signature — so this endpoint will need its own guard when that lands, not
   * this JWT one.
   */
  @Post('inbound')
  async inbound(@Request() req: AuthRequest, @Body() dto: InboundMessageDto) {
    const result = await this.conversations.receiveInbound({
      firmId: req.user.firmId!,
      channel: dto.channel,
      from: dto.from,
      text: dto.text,
      contactName: dto.contactName,
    });

    return {
      conversationId: result.conversation._id.toString(),
      messageId: result.message._id.toString(),
      escalated: result.escalated,
      reason: result.reason ?? null,
    };
  }

  @Get('conversations')
  list(@Query('status') status?: ConversationStatus) {
    return this.conversations.list({ status });
  }

  @Get('conversations/:id')
  async get(@Param('id') id: string) {
    const [conversation, messages] = await Promise.all([
      this.conversations.findById(id),
      this.conversations.messagesFor(id),
    ]);
    return { conversation, messages };
  }

  /** A human closes an escalation and hands the thread back to the agent. */
  @Post('conversations/:id/resolve')
  resolve(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.conversations.resolveEscalation(id, req.user.sub);
  }

  /** Auto-resolve rate, response time and the FAQ list. */
  @Get('stats')
  stats() {
    return this.conversations.stats();
  }
}
