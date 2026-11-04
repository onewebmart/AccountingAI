import { createHmac, timingSafeEqual } from 'crypto';

/**
 * WhatsApp Cloud API webhooks, read. Pure: the signature check and the
 * payload, into the files each message carries.
 */

export interface WhatsAppFileMessage {
  messageId: string;
  /** The sender's number, E.164 digits without '+'. */
  from: string;
  fromName: string | null;
  mediaId: string;
  fileName: string;
  mimeType: string;
  caption: string | null;
}

/** Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  const given = Buffer.from(header.slice(7), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

interface MetaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          document?: { id?: string; filename?: string; mime_type?: string; caption?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
}

/** The documents and photos in a webhook. Text, status updates and the rest carry no file. */
export function filesInWebhook(body: unknown): WhatsAppFileMessage[] {
  const out: WhatsAppFileMessage[] = [];
  for (const entry of (body as MetaWebhook)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name ?? null]));
      for (const m of change.value?.messages ?? []) {
        const media = m.type === 'document' ? m.document : m.type === 'image' ? m.image : undefined;
        if (!m.id || !m.from || !media?.id) continue;
        const mimeType = (media.mime_type ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const fileName =
          (m.type === 'document' && m.document?.filename?.replace(/[\\/\r\n]/g, '_').slice(0, 200)) ||
          `whatsapp-${m.id.slice(-8)}.${EXT[mimeType] ?? 'bin'}`;
        out.push({ messageId: m.id, from: m.from.replace(/\D/g, ''), fromName: names.get(m.from) ?? null, mediaId: media.id, fileName, mimeType, caption: media.caption?.trim() || null });
      }
    }
  }
  return out;
}

export const LINK_CODE_LENGTH = 6;
const LINK_TEXT = new RegExp(`^\\s*link\\s+([a-z2-9]{${LINK_CODE_LENGTH}})\\s*$`, 'i');

/** Text messages that say "LINK <code>": a phone asking to be linked to a business. */
export function linkRequestsInWebhook(body: unknown): Array<{ messageId: string; from: string; code: string }> {
  const out: Array<{ messageId: string; from: string; code: string }> = [];
  for (const entry of (body as MetaWebhook)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const match = m.type === 'text' && m.id && m.from ? LINK_TEXT.exec(m.text?.body ?? '') : null;
        if (match) out.push({ messageId: m.id!, from: m.from!.replace(/\D/g, ''), code: match[1].toLowerCase() });
      }
    }
  }
  return out;
}

/** "+91 98765 43210", "09876543210" or "9876543210" → "919876543210". Null when it cannot be a mobile number. */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
