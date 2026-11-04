import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const PAYMENT_LINK_PROVIDER = Symbol('PAYMENT_LINK_PROVIDER');

export interface CreateLinkInput {
  amountPaise: number;
  description: string;
  /** Ours, unique per link: carried back on the "paid" event. */
  referenceId: string;
  customer: { name: string; email: string | null; phone: string | null };
  /** Unix seconds. */
  expireBy: number;
}

export interface PaidEvent {
  linkId: string;
  referenceId: string | null;
  paidPaise: number;
  gatewayPaymentId: string;
  /** YYYY-MM-DD. */
  paidOn: string;
}

/**
 * The seam between invoices and whoever collects the money online. Business
 * logic sees only this; a real gateway's adapter replaces the test one.
 */
export interface PaymentLinkProvider {
  readonly name: string;
  readonly isMock: boolean;
  createLink(input: CreateLinkInput): Promise<{ linkId: string; url: string }>;
  /** A "paid" callback, checked against the gateway's signature; null for one that is not a payment. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaidEvent | null;
}

const isoDate = (unixSeconds: number) => new Date(unixSeconds * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Razorpay payment links. Amounts go in paise, as Razorpay takes them.
 * Webhooks are verified by the HMAC-SHA256 of the raw body with the webhook
 * secret, compared in constant time.
 */
@Injectable()
export class RazorpayPaymentLinkProvider implements PaymentLinkProvider {
  readonly name = 'razorpay';
  readonly isMock = false;
  private readonly logger = new Logger(RazorpayPaymentLinkProvider.name);

  constructor(private readonly config: ConfigService) {}

  async createLink(input: CreateLinkInput) {
    const keyId = this.config.get<string>('razorpay.keyId')!;
    const keySecret = this.config.get<string>('razorpay.keySecret')!;
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        accept_partial: false,
        description: input.description.slice(0, 2048),
        reference_id: input.referenceId,
        expire_by: input.expireBy,
        customer: {
          name: input.customer.name,
          ...(input.customer.email ? { email: input.customer.email } : {}),
          ...(input.customer.phone ? { contact: input.customer.phone } : {}),
        },
        // We send the invoice ourselves; the gateway need not.
        notify: { sms: false, email: false },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!res.ok || !body.id || !body.short_url) {
      throw new Error(`Razorpay refused the payment link: ${body.error?.description ?? `HTTP ${res.status}`}`);
    }
    return { linkId: body.id, url: body.short_url };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): PaidEvent | null {
    const secret = this.config.get<string>('razorpay.webhookSecret');
    if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set, so no webhook can be trusted.');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = Buffer.from(signature ?? '', 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected, 'utf8'))) {
      throw new Error('The webhook signature does not match.');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      payload?: {
        payment_link?: { entity?: { id?: string; reference_id?: string; amount_paid?: number } };
        payment?: { entity?: { id?: string; amount?: number; created_at?: number } };
      };
    };
    if (event.event !== 'payment_link.paid') return null;
    const link = event.payload?.payment_link?.entity;
    const payment = event.payload?.payment?.entity;
    if (!link?.id || !payment?.id) return null;
    const paidPaise = Number(link.amount_paid ?? payment.amount ?? 0);
    if (!Number.isInteger(paidPaise) || paidPaise <= 0) return null;
    this.logger.log(`Razorpay link ${link.id} paid (${payment.id})`);
    return { linkId: link.id, referenceId: link.reference_id ?? null, paidPaise, gatewayPaymentId: payment.id, paidOn: isoDate(payment.created_at ?? Date.now() / 1000) };
  }
}

/**
 * A stand-in until a gateway is configured. Its links lead nowhere and take
 * no money; "paying" one is done from our own screen, to try the flow.
 */
@Injectable()
export class MockPaymentLinkProvider implements PaymentLinkProvider {
  readonly name = 'mock';
  readonly isMock = true;

  async createLink(input: CreateLinkInput) {
    const linkId = `mock_plink_${randomBytes(6).toString('hex')}`;
    return { linkId, url: `https://pay.example/${linkId}?amount=${input.amountPaise}` };
  }

  parseWebhook(): PaidEvent | null {
    throw new Error('No payment gateway is configured, so there is no webhook to receive.');
  }
}
