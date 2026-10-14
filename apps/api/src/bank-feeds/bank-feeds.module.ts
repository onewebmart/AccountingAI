import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BankFeedConsent, BankFeedConsentSchema } from './schemas/bank-feed-consent.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { BankingModule } from '../banking/banking.module';
import { GlModule } from '../gl/gl.module';
import { BANK_FEED_PROVIDER } from './provider';
import { MockAccountAggregator } from './mock-aa.provider';
import { BankFeedsService } from './bank-feeds.service';
import { BankFeedsController } from './bank-feeds.controller';
import { BANK_FEEDS_QUEUE, BankFeedsProcessor, DAILY_FEED_JOB } from './bank-feeds.processor';

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
    // The mock until an aggregator (Setu, Finvu, OneMoney…) is contracted:
    // a real adapter implements BankFeedProvider and replaces it here.
    { provide: BANK_FEED_PROVIDER, useClass: MockAccountAggregator },
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
