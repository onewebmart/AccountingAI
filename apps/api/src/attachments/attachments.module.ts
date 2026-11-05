import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
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
    ]),
    DocumentsModule, // StorageService
    GlModule, // AuditService
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
