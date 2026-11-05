import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { ProposalsModule } from '../proposals/proposals.module';
import { DocumentsModule } from '../documents/documents.module';
import { GlModule } from '../gl/gl.module';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

/** Files kept against invoices, bills, vouchers, payments, customers, vendors, claims and expenses. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
      { name: User.name, schema: UserSchema }, // read only: who added a file
      // "Add to": the scanned document a record was entered from, and its proposal.
      { name: UploadedDocument.name, schema: DocumentSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
    ]),
    DocumentsModule, // StorageService
    ProposalsModule, // closes a document's proposal once it is entered by hand
    GlModule, // AuditService
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
