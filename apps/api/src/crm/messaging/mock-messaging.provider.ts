import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessagingProvider, SendRequest, SendResult } from './messaging.provider.interface';

/**
 * Default adapter: goes through the motions without touching the network.
 *
 * The message itself is persisted by the queue processor, so the outbox shows
 * exactly what a client would have received. That makes the entire reminder,
 * invoice-chaser and support-agent flow testable today — no Meta Business
 * account, no verified sender number, no template approval, no SMTP.
 *
 * It deliberately does NOT swallow bad input: a send with no recipient is a bug
 * in the caller, and failing here surfaces it instead of silently "succeeding".
 */
@Injectable()
export class MockMessagingProvider implements MessagingProvider {
  readonly name = 'mock';

  private readonly logger = new Logger(MockMessagingProvider.name);

  async send(request: SendRequest): Promise<SendResult> {
    if (!request.to?.trim()) {
      throw new Error(
        `Cannot send ${request.channel}: recipient address is empty. ` +
          'Check the client has a WhatsApp number / email on file.',
      );
    }
    if (!request.body?.trim()) {
      throw new Error(`Cannot send ${request.channel}: message body is empty.`);
    }

    this.logger.log(
      `[MOCK ${request.channel}] → ${request.to}: ${request.body.slice(0, 80).replace(/\n/g, ' ')}…`,
    );

    return { providerMessageId: `mock-${randomUUID()}`, isMock: true };
  }
}
