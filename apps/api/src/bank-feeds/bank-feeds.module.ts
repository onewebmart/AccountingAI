import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BankFeedConsent, BankFeedConsentSchema } from './schemas/bank-feed-consent.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { BankingModule } from '../banking/banking.module';
import { GlModule } from '../gl/gl.module';
import { BANK_FEED_PROVIDER, BankFeedProvider } from './provider';
import { MockAccountAggregator } from './mock-aa.provider';
import { SetuAccountAggregator, SetuSettings } from './setu-aa.provider';
import { BankFeedsService } from './bank-feeds.service';
import { BankFeedsController } from './bank-feeds.controller';
import { BANK_FEEDS_QUEUE, BankFeedsProcessor, DAILY_FEED_JOB } from './bank-feeds.processor';

/**
 * A misconfigured real aggregator stops the API from starting: falling back
 * to the mock would put made-up bank lines in front of someone reconciling.
 */
export function bankFeedProvider(config: ConfigService): BankFeedProvider {
  const which = config.get<string>('bankFeeds.provider') ?? 'mock';
  if (which === 'mock') return new MockAccountAggregator();
  if (which !== 'setu') throw new Error(`BANK_FEED_PROVIDER "${which}" is not one we know: use mock or setu.`);
  const setu = config.get<SetuSettings>('bankFeeds.setu');
  const redirectUrl = setu?.redirectUrl || `${config.get<string>('urls.web') ?? ''}/banking`;
  const missing = (['clientId', 'clientSecret', 'productInstanceId'] as const).filter((k) => !setu?.[k]);
  if (!setu || missing.length) throw new Error(`BANK_FEED_PROVIDER=setu needs SETU_AA_CLIENT_ID, SETU_AA_CLIENT_SECRET and SETU_AA_PRODUCT_INSTANCE_ID (missing: ${missing.join(', ')}).`);
  if (!Number.isInteger(setu.consentMonths) || setu.consentMonths < 1) throw new Error('SETU_AA_CONSENT_MONTHS must be a whole number of months.');
  return new SetuAccountAggregator({ ...setu, redirectUrl });
}

/** Bank feeds through an Account Aggregator, into reconciliation. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankFeedConsent.name, schema: BankFeedConsentSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
    ]),
    BullModule.registerQueue({ name: BANK_FEEDS_QUEUE }),
    BankingModule, // ReconciliationService imports the statements
    GlModule, // AuditService
  ],
  controllers: [BankFeedsController],
  providers: [
    BankFeedsService,
    BankFeedsProcessor,
    // BANK_FEED_PROVIDER picks the aggregator: the mock until one is
    // contracted, or Setu. Another AA is an adapter implementing BankFeedProvider.
    { provide: BANK_FEED_PROVIDER, inject: [ConfigService], useFactory: bankFeedProvider },
  ],
})
export class BankFeedsModule implements OnModuleInit {
  private readonly logger = new Logger(BankFeedsModule.name);

  constructor(@InjectQueue(BANK_FEEDS_QUEUE) private readonly queue: Queue) {}

  /** Pulls every active feed at 05:30 IST, before the books sweep drafts and reminds. */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(DAILY_FEED_JOB, {}, { jobId: DAILY_FEED_JOB, repeat: { pattern: '30 5 * * *', tz: 'Asia/Kolkata' }, removeOnComplete: true });
    } catch (err) {
      this.logger.error(`Could not schedule the daily feed pull: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
