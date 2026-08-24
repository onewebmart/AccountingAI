import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import {
  FirmService,
  LeadQualificationStatus,
  LeadSource,
  LeadStage,
} from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type LeadDocument = HydratedDocument<Lead>;

/**
 * What the AI concluded about a lead.
 *
 * Advisory only. It carries a recommended stage but never applies one — a
 * human moves the lead, which is Invariant 4 applied to the pipeline.
 */
@Schema({ _id: false })
export class LeadQualification {
  @Prop({
    type: String,
    enum: Object.values(LeadQualificationStatus),
    default: LeadQualificationStatus.NOT_STARTED,
  })
  status: LeadQualificationStatus;

  /** 0–100. How well this lead fits the firm's practice. */
  @Prop({ min: 0, max: 100 }) score?: number;

  /** One short paragraph a partner can read in five seconds. */
  @Prop() summary?: string;

  /** Concrete reasons behind the score. */
  @Prop({ type: [String], default: [] }) signals: string[];

  /** What the firm still needs to find out before proposing. */
  @Prop({ type: [String], default: [] }) openQuestions: string[];

  /**
   * Stage the model would move this lead to. Rendered as a suggestion in amber;
   * applying it is a human click.
   */
  @Prop({ type: String, enum: Object.values(LeadStage) })
  recommendedStage?: LeadStage;

  @Prop() model?: string;
  @Prop() ranAt?: Date;
  @Prop() error?: string;
}

export const LeadQualificationSchema = SchemaFactory.createForClass(LeadQualification);

/** An audit trail of pipeline movement, so "who moved this and when" is answerable. */
@Schema({ _id: false })
export class StageChange {
  @Prop({ type: String, enum: Object.values(LeadStage), required: true }) from: LeadStage;
  @Prop({ type: String, enum: Object.values(LeadStage), required: true }) to: LeadStage;
  @Prop({ required: true }) changedBy: string;
  @Prop({ required: true }) changedAt: Date;
  @Prop() note?: string;
}

export const StageChangeSchema = SchemaFactory.createForClass(StageChange);

/**
 * A prospective client. Deliberately NOT an Organization: a lead may never
 * become one, has no books, and would pollute tenant-scoped queries. It becomes
 * an Organization only on conversion.
 */
@Schema({ timestamps: true, collection: 'crm_leads' })
export class Lead {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop() contactName?: string;
  @Prop() whatsappNumber?: string;
  @Prop() email?: string;

  @Prop({ type: String, enum: Object.values(LeadSource), required: true, index: true })
  source: LeadSource;

  /** What they are asking for. */
  @Prop({ type: [String], enum: Object.values(FirmService), default: [] })
  services: FirmService[];

  /** Free-text of what the enquiry actually said — the AI's main input. */
  @Prop() enquiryNotes?: string;

  /**
   * Expected annual fee, in integer paise (Invariant 1). The prototype's
   * "₹85,000" is 8_500_000 here; nothing but display divides by 100.
   */
  @Prop({
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'estimatedValuePaise must be an integer number of paise',
    },
  })
  estimatedValuePaise?: number;

  @Prop({
    type: String,
    enum: Object.values(LeadStage),
    required: true,
    default: LeadStage.NEW,
    index: true,
  })
  stage: LeadStage;

  /** Team member responsible. */
  @Prop() assignedTo?: string;

  @Prop({ type: LeadQualificationSchema, default: () => ({}) })
  qualification: LeadQualification;

  @Prop({ type: [StageChangeSchema], default: [] })
  stageHistory: StageChange[];

  /** Set when the lead is won and an Organization is created for them. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization' })
  convertedOrgId?: Types.ObjectId;

  @Prop() lastContactedAt?: Date;

  /** When a follow-up is due — drives the "no response, escalate" nudge. */
  @Prop() followUpDueAt?: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.plugin(firmIsolationPlugin);

// The pipeline board reads "this firm's leads, by stage, newest first".
LeadSchema.index({ firmId: 1, stage: 1, createdAt: -1 });

// The follow-up sweep looks for leads whose nudge is overdue.
LeadSchema.index({ firmId: 1, followUpDueAt: 1 });
