import { MessageChannel } from '@ai-accounting/shared';

export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export interface SendRequest {
  channel: MessageChannel;
  /** Phone number for WhatsApp, email address for EMAIL. */
  to: string;
  /** Email only — ignored by WhatsApp. */
  subject?: string;
  body: string;
}

export interface SendResult {
  /** The provider's own message id, when it issues one. */
  providerMessageId?: string;
  /** False only when a real network call actually happened. */
  isMock: boolean;
}

/**
 * The seam between CRM business logic and however messages physically leave.
 *
 * Business logic depends on this interface only, so swapping the mock for a real
 * WhatsApp Business API or SMTP adapter is a module-level provider change and
 * touches no reminder, invoice or agent code.
 *
 * Implementations must throw on failure — the queue processor records the error
 * and marks the message FAILED.
 */
export interface MessagingProvider {
  /** Human-readable adapter name, surfaced in the settings UI. */
  readonly name: string;

  send(request: SendRequest): Promise<SendResult>;
}
