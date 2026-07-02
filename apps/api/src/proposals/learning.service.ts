import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import IORedis from 'ioredis';
import { VendorLedgerMap, VendorLedgerMapDocument } from './schemas/vendor-ledger-map.schema';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 86_400; // 24 hours

export interface LedgerMapping {
  ledgerAccountId: string;
  accountName: string;
}

function normalizeVendor(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    @InjectModel(VendorLedgerMap.name)
    private readonly mapModel: Model<VendorLedgerMapDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  private cacheKey(orgId: string, vendor: string): string {
    return `vlm:${orgId}:${normalizeVendor(vendor)}`;
  }

  /**
   * Record (or strengthen) the mapping from a vendor to a ledger account.
   * Called when a human confirms or corrects the suggested account.
   */
  async upsertMapping(
    orgId: string,
    vendor: string,
    ledgerAccountId: string,
    accountName: string,
  ): Promise<void> {
    const normalized = normalizeVendor(vendor);

    await this.mapModel
      .findOneAndUpdate(
        { orgId, vendor: normalized },
        {
          $set: { ledgerAccountId, accountName },
          $inc: { count: 1, strength: 1 },
        },
        { upsert: true, new: true },
      )
      .exec();

    try {
      await this.redis.set(
        this.cacheKey(orgId, vendor),
        JSON.stringify({ ledgerAccountId, accountName } satisfies LedgerMapping),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`Redis set failed for vendor="${normalized}": ${String(err)}`);
    }

    this.logger.log(
      `Learned: org=${orgId} vendor="${normalized}" → ${accountName} (${ledgerAccountId})`,
    );
  }

  /**
   * Return the strongest-confidence ledger mapping for this vendor, or null.
   * Checks Redis first; falls back to MongoDB and repopulates the cache.
   */
  async getMapping(orgId: string, vendor: string): Promise<LedgerMapping | null> {
    const key = this.cacheKey(orgId, vendor);

    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as LedgerMapping;
    } catch (err) {
      this.logger.warn(`Redis get failed for key="${key}": ${String(err)}`);
    }

    const doc = await this.mapModel
      .findOne({ orgId, vendor: normalizeVendor(vendor) })
      .sort({ strength: -1 })
      .exec();

    if (!doc) return null;

    const result: LedgerMapping = {
      ledgerAccountId: doc.ledgerAccountId,
      accountName: doc.accountName,
    };

    try {
      await this.redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis repopulate failed for key="${key}": ${String(err)}`);
    }

    return result;
  }
}
