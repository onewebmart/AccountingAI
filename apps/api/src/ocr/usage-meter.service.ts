import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsageMeter, UsageMeterDocument } from './schemas/usage-meter.schema';

@Injectable()
export class UsageMeterService {
  constructor(
    @InjectModel(UsageMeter.name) private meterModel: Model<UsageMeterDocument>,
  ) {}

  private currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async recordOcrPages(orgId: string, tier: number, pageCount: number): Promise<void> {
    const period = this.currentPeriod();
    const field = `ocrPagesTier${tier}`;
    await this.meterModel
      .findOneAndUpdate(
        { orgId, period },
        { $inc: { [field]: pageCount }, $setOnInsert: { orgId, period } },
        { upsert: true, new: true },
      )
      .exec();
  }

  async recordAiTokens(orgId: string, tokensIn: number, tokensOut: number): Promise<void> {
    const period = this.currentPeriod();
    await this.meterModel
      .findOneAndUpdate(
        { orgId, period },
        {
          $inc: { groqTokensIn: tokensIn, groqTokensOut: tokensOut },
          $setOnInsert: { orgId, period },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async getUsage(orgId: string, period?: string): Promise<UsageMeterDocument | null> {
    const p = period ?? this.currentPeriod();
    return this.meterModel.findOne({ orgId, period: p }).exec();
  }
}
