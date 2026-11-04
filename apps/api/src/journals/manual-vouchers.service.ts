import { BadRequestException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { VoucherType } from '@ai-accounting/shared';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { ApprovalsService } from '../approvals/approvals.service';

export interface ManualVoucherInput {
  voucherType?: VoucherType;
  financialYear?: string;
  date?: string;
  narration?: string;
  lines: Array<{ accountId: string; description?: string; debitPaise: number; creditPaise: number }>;
}

/**
 * A voucher a person types. Under an approval policy for journals it waits
 * for approval, kept as it was entered, and posts in the approver's name.
 */
@Injectable()
export class ManualVouchersService implements OnModuleInit {
  constructor(
    private readonly posting: PostingService,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals?.register('journal', async (orgId, actorId, request) => {
      const journal = await this.postNow(orgId, actorId, (request.payload as { voucher: ManualVoucherInput }).voucher);
      return String(journal._id);
    });
  }

  async post(orgId: string, actorId: string, actorRole: string, body: ManualVoucherInput) {
    if (!Array.isArray(body.lines) || body.lines.length < 2) throw new BadRequestException('A voucher needs at least two lines.');
    const amount = body.lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0);
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    if (this.approvals) {
      await this.approvals.gate({
        orgId, docType: 'journal', docId: null, payload: { kind: 'journal', voucher: { ...body, date } },
        summary: `${body.voucherType ?? VoucherType.JOURNAL} voucher — ${body.narration ?? ''}`.slice(0, 200), amountPaise: amount,
        makerId: actorId, actorId, actorRole, facts: { date, amountPaise: amount },
      });
    }
    return this.postNow(orgId, actorId, { ...body, date });
  }

  private postNow(orgId: string, actorId: string, body: ManualVoucherInput) {
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    return this.posting.post({
      orgId,
      voucherType: body.voucherType ?? VoucherType.JOURNAL,
      financialYear: body.financialYear ?? financialYearOf(date),
      date,
      narration: body.narration,
      postedBy: actorId,
      lines: body.lines,
    });
  }
}
