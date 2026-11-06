import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { assertPaise } from '@ai-accounting/shared';

/** The customer or vendor a line is about, named as it was when posted. */
@Schema({ _id: false })
export class LineContact {
  @Prop({ type: String, enum: ['customer', 'vendor'], required: true })
  kind: 'customer' | 'vendor';

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  id: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, default: '' })
  name: string;
}
const LineContactSchema = SchemaFactory.createForClass(LineContact);

@Schema({ _id: false })
export class JournalLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  accountId: MongooseSchema.Types.ObjectId;

  @Prop({ default: '' })
  description: string;

  /** Integer paise — exactly one of debit/credit is non-zero per line */
  @Prop({ required: true, default: 0, validate: { validator: Number.isInteger, message: 'debitPaise must be an integer' } })
  debitPaise: number;

  @Prop({ required: true, default: 0, validate: { validator: Number.isInteger, message: 'creditPaise must be an integer' } })
  creditPaise: number;

  /** The project this line's income or cost belongs to. Set when the journal is posted, never after. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null })
  projectId?: MongooseSchema.Types.ObjectId | null;

  /**
   * A customer or vendor the line is about, shown in ledgers. A tag only: what
   * a party owes is kept by its documents, so lines on the receivable and
   * payable accounts come from those documents, never from a manual journal.
   */
  @Prop({ type: LineContactSchema, default: null })
  contact?: LineContact | null;
}

export const JournalLineSchema = SchemaFactory.createForClass(JournalLine);

JournalLineSchema.pre('validate', function (this: JournalLine) {
  assertPaise(this.debitPaise);
  assertPaise(this.creditPaise);
});
