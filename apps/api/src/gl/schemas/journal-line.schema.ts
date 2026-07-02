import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { assertPaise } from '@ai-accounting/shared';

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
}

export const JournalLineSchema = SchemaFactory.createForClass(JournalLine);

JournalLineSchema.pre('validate', function (this: JournalLine) {
  assertPaise(this.debitPaise);
  assertPaise(this.creditPaise);
});
