import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GSP_PROVIDER, GspProvider, MockGsp } from '../einvoice/gsp.provider';

/**
 * GSP_PROVIDER picks the gateway. Only the mock exists until a GSP is
 * contracted: an unknown name stops the API rather than quietly pretending
 * invoices were registered or returns filed.
 */
export function gspProvider(config: ConfigService): GspProvider {
  const which = config.get<string>('gsp.provider') ?? 'mock';
  if (which === 'mock') return new MockGsp();
  throw new Error(`GSP_PROVIDER "${which}" has no adapter yet: only "mock" is available.`);
}

/** One gateway, and one mock's memory, for e-invoices, e-way bills and returns. */
@Global()
@Module({
  providers: [{ provide: GSP_PROVIDER, inject: [ConfigService], useFactory: gspProvider }],
  exports: [GSP_PROVIDER],
})
export class GspModule {}
