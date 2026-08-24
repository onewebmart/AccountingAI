import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  MessageChannel,
  MessageDirection,
  MessageStatus,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type CrmMessageDocument = HydratedDocument<CrmMessage>;

/**
 * Every message the CRM sends or receives, whatever the channel and whoever
 * the provider. This IS the outbox: the mock adapter writes here instead of
 * calling out, so the whole reminder/agent flow is inspectable with no
 * WhatsApp Business account and no SMTP.
 *
 * Firm-scoped (not org-scoped): a firm's conversations span its whole client
 * book, and a lead has no orgId at all.
 */
@Schema({ timestamps: true, collection: 'crm_messages' })
export class CrmMessage {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, enum: Object.values(MessageChannel), required: true, index: true })
  channel: MessageChannel;

  @Prop({
    type: String,
    enum: Object.values(MessageDirection),
    required: true,
    default: MessageDirection.OUTBOUND,
  })
  direction: MessageDirection;

  @Prop({
    type: String,
    enum: Object.values(MessageStatus),
    required: true,
    default: MessageStatus.QUEUED,
    index: true,
  })
  status: MessageStatus;

  // ── Recipient ───────────────────────────────────────────────────────────────
  // A message goes to a client org OR a lead. Both are optional because an ad-hoc
  // test send has neither; the resolved address below is what actually matters.

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', index: true })
  clientOrgId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CrmLead', index: true })
  leadId?: MongooseSchema.Types.ObjectId;

  /** The support-agent thread this message belongs to, when it is part of one. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Conversation', index: true })
  conversationId?: MongooseSchema.Types.ObjectId;

  /** Display name at send time — kept even if the client is renamed later. */
  @Prop() recipientName?: string;

  /** The resolved destination: a phone number for WhatsApp, an address for email. */
  @Prop({ required: true })
  recipientAddress: string;

  // ── Content ─────────────────────────────────────────────────────────────────

  @Prop({ type: String, enum: Object.values(MessageTemplateKey), index: true })
  templateKey?: MessageTemplateKey;

  /** Subject line — email only. */
  @Prop() subject?: string;

  /** The final text after variable substitution, exactly as the client sees it. */
  @Prop({ required: true })
  body: string;

  // ── Delivery ────────────────────────────────────────────────────────────────

  /**
   * True when no real provider was involved. Renders as a badge in the outbox so
   * nobody mistakes a mock send for something the client actually received.
   */
  @Prop({ default: true })
  isMock: boolean;

  /** Provider's own id, once a real adapter is wired in. */
  @Prop() providerMessageId?: string;

  @Prop() sentAt?: Date;

  @Prop() error?: string;

  /**
   * What caused this send — e.g. { type: 'complianceItem', id: '...' }.
   * Reminder jobs use it to stay idempotent and the outbox uses it for filtering.
   */
  @Prop({ type: Object })
  cause?: { type: string; id: string };
}

export const CrmMessageSchema = SchemaFactory.createForClass(CrmMessage);

CrmMessageSchema.plugin(firmIsolationPlugin);

// Outbox reads are "this firm's messages, newest first".
CrmMessageSchema.index({ firmId: 1, createdAt: -1 });
