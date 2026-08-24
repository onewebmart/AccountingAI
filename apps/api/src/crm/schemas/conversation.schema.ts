import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import {
  ConversationStatus,
  EscalationReason,
  MessageChannel,
} from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type ConversationDocument = HydratedDocument<Conversation>;

/** Why and when a thread was handed to a person. */
@Schema({ _id: false })
export class Escalation {
  @Prop({ type: String, enum: Object.values(EscalationReason), required: true })
  reason: EscalationReason;

  /** The client message that triggered it, for the CA to read first. */
  @Prop() triggeredBy?: string;

  @Prop({ required: true }) escalatedAt: Date;
  @Prop() resolvedAt?: Date;
  @Prop() resolvedBy?: string;
}

export const EscalationSchema = SchemaFactory.createForClass(Escalation);

/**
 * A conversation thread with one client or lead on one channel.
 *
 * The agent replies within a thread; a thread in ESCALATED status is a hard
 * stop — no automated reply goes out until a human resolves it. That is the
 * safety boundary for letting a model speak on a CA firm's behalf.
 */
@Schema({ timestamps: true, collection: 'crm_conversations' })
export class Conversation {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', index: true })
  clientOrgId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CrmLead', index: true })
  leadId?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(MessageChannel), required: true })
  channel: MessageChannel;

  /** Display name at the time of the first message. */
  @Prop() contactName?: string;

  /** Phone number or email — the thread key alongside the channel. */
  @Prop({ required: true, index: true })
  contactAddress: string;

  @Prop({
    type: String,
    enum: Object.values(ConversationStatus),
    required: true,
    default: ConversationStatus.ACTIVE,
    index: true,
  })
  status: ConversationStatus;

  @Prop({ type: EscalationSchema })
  escalation?: Escalation;

  @Prop() lastInboundAt?: Date;
  @Prop() lastOutboundAt?: Date;

  /** Counters behind the "auto-resolve rate" the prototype shows. */
  @Prop({ default: 0 }) inboundCount: number;
  @Prop({ default: 0 }) autoRepliedCount: number;

  /** Total milliseconds between inbound messages and their auto-replies. */
  @Prop({ default: 0 }) totalResponseMs: number;

  /**
   * Short topic label the model assigns, e.g. "GST filing deadline". Aggregated
   * into the FAQ list so a firm can see what clients keep asking.
   */
  @Prop({ type: [String], default: [] })
  topics: string[];
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.plugin(firmIsolationPlugin);

/** One thread per contact per channel — the lookup the inbound hook does. */
ConversationSchema.index({ firmId: 1, channel: 1, contactAddress: 1 }, { unique: true });

ConversationSchema.index({ firmId: 1, status: 1, lastInboundAt: -1 });
