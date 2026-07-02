import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * Counters collection — atomic source of gapless sequential numbering.
 * _id is a composite string: "{orgId}:{VoucherType}:{financialYear}"
 * e.g. "org123:PURCHASE:2024-25"
 *
 * $inc on seq inside the same transaction as the journal insert guarantees
 * no gaps even under concurrent writes (MongoDB serializes within a session).
 */
@Schema({ collection: 'counters', _id: false })
export class Counter {
  /** String composite key — NOT an ObjectId */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
