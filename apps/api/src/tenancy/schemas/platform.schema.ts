import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlatformDocument = HydratedDocument<Platform>;

@Schema({ timestamps: true, collection: 'platforms' })
export class Platform {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true })
  adminEmail: string;
}

export const PlatformSchema = SchemaFactory.createForClass(Platform);
