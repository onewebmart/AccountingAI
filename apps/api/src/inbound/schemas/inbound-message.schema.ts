import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type InboundMessageDocument = HydratedDocument<InboundMessage>;

/**
 * One email or WhatsApp message sent in, and what became of each file in it.
 * Accepted files are ordinary uploads from here on: read, proposed, reviewed.
 */
@Schema({ collection: 'inbound_messages', timestamps: true })
export class InboundMessage {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ['email', 'whatsapp'], required: true }) channel: 'email' | 'whatsapp';
  /** An email address, or a phone number in E.164 digits. */
  @Prop({ type: String, default: null }) from: string | null;
  @Prop({ type: String, default: null }) fromName: string | null;
  /** A team member or a vendor on file. */
  @Prop({ type: Boolean, default: false }) knownSender: boolean;
  @Prop({ type: String, default: null }) subject: string | null;
  /** The provider's id for the message: a message delivered twice is handled once. */
  @Prop({ type: String, required: true }) messageId: string;
  @Prop({ type: [Object], default: [] })
  files: Array<{
    fileName: string;
    status: 'accepted' | 'duplicate' | 'rejected' | 'skipped';
    reason: string | null;
    documentId: Types.ObjectId | null;
  }>;
}

export const InboundMessageSchema = SchemaFactory.createForClass(InboundMessage);
InboundMessageSchema.index({ orgId: 1, channel: 1, messageId: 1 }, { unique: true });
InboundMessageSchema.index({ orgId: 1, createdAt: -1 });
InboundMessageSchema.plugin(tenantIsolationPlugin);
