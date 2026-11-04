/**
 * An inbound email as the mail provider delivers it to our webhook, read
 * into one shape. The format is Postmark's inbound JSON (From, To, Subject,
 * MessageID, Attachments with base64 Content); another provider's adapter
 * would produce the same InboundEmail.
 */

export interface InboundEmail {
  /** Every address it was sent to: To, Cc and the original recipient. */
  recipients: string[];
  from: string | null;
  fromName: string | null;
  subject: string | null;
  messageId: string | null;
  attachments: Array<{ fileName: string; mimeType: string; buffer: Buffer; contentId: string | null }>;
}

interface PostmarkAddress {
  Email?: string;
  Name?: string;
}

interface PostmarkInbound {
  From?: string;
  FromFull?: PostmarkAddress;
  To?: string;
  ToFull?: PostmarkAddress[];
  Cc?: string;
  CcFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  Subject?: string;
  MessageID?: string;
  Attachments?: Array<{ Name?: string; Content?: string; ContentType?: string; ContentID?: string }>;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function parsePostmarkInbound(body: unknown): InboundEmail {
  const p = (body ?? {}) as PostmarkInbound;
  const addresses = [
    ...(p.ToFull ?? []).map((a) => a.Email ?? ''),
    ...(p.CcFull ?? []).map((a) => a.Email ?? ''),
    ...(`${p.To ?? ''} ${p.Cc ?? ''} ${p.OriginalRecipient ?? ''}`.match(EMAIL) ?? []),
  ]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const from = (p.FromFull?.Email ?? (p.From ?? '').match(EMAIL)?.[0] ?? '').trim().toLowerCase() || null;
  return {
    recipients: [...new Set(addresses)],
    from,
    fromName: p.FromFull?.Name?.trim() || null,
    subject: p.Subject?.trim() || null,
    messageId: p.MessageID?.trim() || null,
    attachments: (p.Attachments ?? [])
      .filter((a) => typeof a.Content === 'string' && a.Content.length > 0)
      .map((a) => ({
        fileName: (a.Name ?? 'attachment').replace(/[\\/\r\n]/g, '_').slice(0, 200),
        mimeType: (a.ContentType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase(),
        buffer: Buffer.from(a.Content!, 'base64'),
        contentId: a.ContentID?.trim() || null,
      })),
  };
}

/**
 * A small image embedded in the body (a logo in a signature) is not a bill.
 * Real bills arrive as PDFs, or as photos far larger than this.
 */
export function looksLikeSignatureImage(a: { fileName: string; mimeType: string; buffer: Buffer; contentId: string | null }): boolean {
  if (!a.mimeType.startsWith('image/')) return false;
  return a.buffer.length < 20_000 && (!!a.contentId || /^image\d{3}\./i.test(a.fileName));
}
