import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/** Business mail, such as invoices to customers. */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
