import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  cc?: string[];
  replyTo?: string | null;
  /** The name the mail is from, e.g. the business sending its invoice. */
  fromName: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

/**
 * Business mail: invoices to customers. Unlike sign-up and password mail,
 * which fall back to a test inbox, this never pretends: with no SMTP server
 * configured it sends nothing and says so, so a page can tell the person
 * their invoice did not go out.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('email.host');
    const port = config.get<number>('email.port') ?? 587;
    this.from = config.get<string>('email.from') ?? 'noreply@aibooks.in';
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user: config.get<string>('email.user'), pass: config.get<string>('email.pass') },
        })
      : null;
  }

  /** Whether mail can actually leave this server. */
  get configured(): boolean {
    return this.transporter !== null;
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    if (!this.transporter) throw new Error('No mail server is configured');
    const info = await this.transporter.sendMail({
      from: `"${mail.fromName.replace(/"/g, "'")}" <${this.from}>`,
      to: mail.to,
      cc: mail.cc?.length ? mail.cc : undefined,
      replyTo: mail.replyTo ?? undefined,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments,
    });
    this.logger.log(`Mail ${info.messageId} sent to ${mail.to}: ${mail.subject}`);
    return { messageId: String(info.messageId) };
  }
}
