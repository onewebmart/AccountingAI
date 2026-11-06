import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type DocumentFolderDocument = HydratedDocument<DocumentFolder>;

/**
 * A folder a person files documents in: "GST returns", "Rent agreements".
 * It only groups files; it changes nothing in the books. Deleting one moves
 * its files to no folder; the files themselves stay.
 */
@Schema({ collection: 'document_folders', timestamps: true })
export class DocumentFolder {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 60 }) name: string;
  /** The name lower-cased and spaces collapsed: one org cannot have two folders of the same name, whatever the case. */
  @Prop({ type: String, required: true }) nameKey: string;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const DocumentFolderSchema = SchemaFactory.createForClass(DocumentFolder);
DocumentFolderSchema.index({ orgId: 1, nameKey: 1 }, { unique: true });
DocumentFolderSchema.plugin(tenantIsolationPlugin);
