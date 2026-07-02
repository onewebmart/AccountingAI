import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * User is NOT tenant-scoped — a single user can be a member of
 * multiple orgs (e.g. a CA managing several client companies).
 * The OrgMembership document links users to orgs with a role.
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** Not selected by default — never expose in API responses */
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ index: true, sparse: true })
  googleId?: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  totpEnabled: boolean;

  /** Encrypted TOTP secret — never expose in API responses */
  @Prop({ select: false })
  totpSecret?: string;

  /** Refresh token hash for revocation — rotated on every refresh */
  @Prop({ select: false })
  refreshTokenHash?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
