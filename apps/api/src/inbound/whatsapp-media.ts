import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const WHATSAPP_MEDIA = Symbol('WHATSAPP_MEDIA');

/** Fetching a file a WhatsApp message carries. An interface, so tests need no Meta account. */
export interface WhatsAppMediaFetcher {
  readonly configured: boolean;
  fetch(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }>;
}

/**
 * Meta's Graph API: the media id gives a short-lived URL, which the same
 * access token downloads.
 */
@Injectable()
export class MetaWhatsAppMedia implements WhatsAppMediaFetcher {
  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!this.config.get<string>('inbound.whatsappAccessToken');
  }

  async fetch(mediaId: string) {
    const token = this.config.get<string>('inbound.whatsappAccessToken');
    if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is not set.');
    const version = this.config.get<string>('inbound.whatsappGraphVersion') ?? 'v21.0';
    const auth = { Authorization: `Bearer ${token}` };
    const meta = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, { headers: auth });
    const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } };
    if (!meta.ok || !info.url) throw new Error(`WhatsApp media ${mediaId}: ${info.error?.message ?? `HTTP ${meta.status}`}`);
    const file = await fetch(info.url, { headers: auth });
    if (!file.ok) throw new Error(`WhatsApp media ${mediaId}: download HTTP ${file.status}`);
    return { buffer: Buffer.from(await file.arrayBuffer()), mimeType: info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream' };
  }
}
