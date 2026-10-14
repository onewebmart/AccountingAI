import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { ImportedAccount, ImportedParty, ImportSource } from '../source-parsers';

export type ImportBatchDocument = HydratedDocument<ImportBatch>;

/**
 * One import from another system: what was read, as the person previews it,
 * and what committing it created. Committed once; a second commit finds
 * nothing to claim.
 */
@Schema({ collection: 'import_batches', timestamps: true })
export class ImportBatch {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) source: ImportSource;
  @Prop({ type: [String], default: [] }) fileNames: string[];
  @Prop({ type: String, enum: ['previewed', 'committing', 'committed'], default: 'previewed', index: true })
  status: 'previewed' | 'committing' | 'committed';

  @Prop({ type: [Object], default: [] }) accounts: ImportedAccount[];
  @Prop({ type: [Object], default: [] }) parties: ImportedParty[];
  @Prop({ type: [String], default: [] }) warnings: string[];

  @Prop({ type: String, default: null }) openingDate: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null }) journalId: Types.ObjectId | null;
  @Prop({ type: Object, default: null })
  result: {
    accountsCreated: number;
    accountsMatched: number;
    customersCreated: number;
    vendorsCreated: number;
    partiesMatched: number;
    documentsCreated: number;
  } | null;
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
  @Prop({ type: String, default: null }) committedBy: string | null;
}

export const ImportBatchSchema = SchemaFactory.createForClass(ImportBatch);
ImportBatchSchema.plugin(tenantIsolationPlugin);
