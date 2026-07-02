import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private config: ConfigService) {
    const host = config.get<string>('email.host');

    if (!host) {
      // Dev: use Ethereal (auto-generated test account, previews logged to console)
      this.initEthereal();
    } else {
      this.transporter = nodemailer.createTransport({
        host,
        port: config.get<number>('email.port'),
        auth: {
          user: config.get<string>('email.user'),
          pass: config.get<string>('email.pass'),
        },
      });
    }
  }

  private async initEthereal() {
    const testAccount = await nodemailer.createTestAccount();
    this.transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    this.logger.log(`📧 Dev email via Ethereal: ${testAccount.user}`);
  }

  async sendPasswordReset(to: string, name: string, resetLink: string): Promise<void> {
    const from = this.config.get<string>('email.from');
    const webUrl = this.config.get<string>('urls.web');

    const info = await this.transporter.sendMail({
      from: `"AiBooks" <${from}>`,
      to,
      subject: 'Reset your password',
      text: `Hi ${name},\n\nClick the link below to reset your password. It expires in 15 minutes.\n\n${resetLink}\n\nIf you didn't request this, ignore this email.\n\n— The AiBooks team`,
      html: `
        <p>Hi ${name},</p>
        <p>Click the button below to reset your password. The link expires in <strong>15 minutes</strong>.</p>
        <p><a href="${resetLink}" style="background:#E8590C;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a></p>
        <p>If you didn't request this, ignore this email.</p>
        <p>— The AiBooks team</p>
        <p><small><a href="${webUrl}">${webUrl}</a></small></p>
      `,
    });

    // In dev, log the Ethereal preview URL
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      this.logger.log(`Password reset email preview: ${preview}`);
    }
  }

  async sendWelcome(to: string, name: string): Promise<void> {
    const from = this.config.get<string>('email.from');
    const webUrl = this.config.get<string>('urls.web');

    const info = await this.transporter.sendMail({
      from: `"AiBooks" <${from}>`,
      to,
      subject: 'Welcome to AiBooks',
      text: `Hi ${name},\n\nYour AiBooks account is ready. Start by uploading some documents.\n\n${webUrl}/dashboard\n\n— The AiBooks team`,
      html: `
        <p>Hi ${name},</p>
        <p>Your AiBooks account is ready. Start by uploading some documents and watch entries appear.</p>
        <p><a href="${webUrl}/dashboard" style="background:#E8590C;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Go to dashboard</a></p>
        <p>— The AiBooks team</p>
      `,
    });

    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      this.logger.log(`Welcome email preview: ${preview}`);
    }
  }
}
