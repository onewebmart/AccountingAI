import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { VoucherType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { GSP_PROVIDER, GspProvider, GspRejected, MOCK_FILING_OTP } from '../einvoice/gsp.provider';
import { withOrg } from '../database/tenant.plugin';
import { todayIst } from '../automation/schedule';
import { GstFiling, GstFilingDocument } from './schemas/gst-filing.schema';
import { GstReturnsService } from './gst-returns.service';
import { Gstr1, Gstr3b } from './gst-returns';
import { ReviewFlag, reviewGstr1, reviewGstr3b } from './filing-review';
import { buildGstr9, monthsOf } from './gstr9';

type ReturnKind = 'GSTR1' | 'GSTR3B';

const previous = (period: string, n: number): string[] => {
  const [y, m] = period.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 2 - i, 1));
    return d.toISOString().slice(0, 7);
  });
};

/**
 * Filing GSTR-1 and GSTR-3B through the GSP: save, OTP, file. Each step is
 * a person's action; filing is final and outward-facing, so it needs the
 * return to read exactly as it did when saved, and is audited with its ARN.
 * The GST payment voucher, from the saved 3B's set-off, is the one posting.
 */
@Injectable()
export class GstFilingService {
  constructor(
    @InjectModel(GstFiling.name) private filingModel: Model<GstFilingDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @Inject(GSP_PROVIDER) private gsp: GspProvider,
    private returns: GstReturnsService,
    private posting: PostingService,
    private accounts: AccountsService,
    private audit: AuditService,
  ) {}

  async status(orgId: string, period: string) {
    const filings = await this.filingModel.find({ orgId, period }).lean().exec();
    return {
      provider: { name: this.gsp.name, isMock: this.gsp.isMock, testOtp: this.gsp.isMock ? MOCK_FILING_OTP : null },
      GSTR1: filings.find((f) => f.returnType === 'GSTR1') ?? null,
      GSTR3B: filings.find((f) => f.returnType === 'GSTR3B') ?? null,
    };
  }

  /** This month against the last six, before filing. */
  async review(orgId: string, kind: ReturnKind, period: string): Promise<ReviewFlag[]> {
    const months = previous(period, 6);
    if (kind === 'GSTR1') {
      const [current, ...history] = await Promise.all([period, ...months].map((p) => this.returns.gstr1(orgId, p)));
      return reviewGstr1(current, history.filter((h) => h.summary.some((r) => r.count > 0)));
    }
    const [current, ...history] = await Promise.all([period, ...months].map((p) => this.returns.gstr3b(orgId, p)));
    return reviewGstr3b(current, history.filter((h) => h.outwardTaxable.txval > 0 || h.itcNet.camt + h.itcNet.iamt > 0));
  }

  async save(orgId: string, actorId: string, kind: ReturnKind, period: string) {
    const gstin = await this.gstin(orgId);
    const existing = await this.filingModel.findOne({ orgId, returnType: kind, period }).exec();
    if (existing?.status === 'filed') throw new ConflictException(`${this.label(kind)} for ${period} is already filed (ARN ${existing.arn}).`);
    if (kind === 'GSTR3B') {
      const r1 = await this.filingModel.findOne({ orgId, returnType: 'GSTR1', period, status: 'filed' }).lean().exec();
      if (!r1) throw new BadRequestException('File GSTR-1 for the month first: the portal fills GSTR-3B’s sales from it.');
    }
    const { json, built } = await this.build(orgId, kind, period);
    const blocking = built.issues.filter((i) => i.level === 'block');
    if (blocking.length) throw new BadRequestException(`Fix these before saving: ${blocking.map((i) => i.message).join(' ')}`);

    const { reference } = await this.call(() => this.gsp.saveReturn(gstin, kind, period, json));
    const fields = { gstin, status: 'saved' as const, payloadHash: this.hash(json), snapshot: this.snapshot(kind, built), portalReference: reference, savedBy: actorId, savedAt: new Date(), provider: this.gsp.name, isTest: this.gsp.isMock };
    const filing = existing ? existing.set(fields) : new this.filingModel({ orgId, returnType: kind, period, ...fields });
    await filing.save();
    await this.audit.record({ orgId, entityType: 'GstFiling', entityId: filing._id.toString(), action: 'SAVE_RETURN', performedBy: actorId, after: { returnType: kind, period, reference, test: this.gsp.isMock } });
    return filing;
  }

  async requestOtp(orgId: string, actorId: string, kind: ReturnKind, period: string) {
    const filing = await this.filing(orgId, kind, period);
    if (filing.status === 'filed') throw new ConflictException('Already filed.');
    const { sentTo } = await this.call(() => this.gsp.requestFilingOtp(filing.gstin, kind, period));
    filing.status = 'otp_sent';
    await filing.save();
    await this.audit.record({ orgId, entityType: 'GstFiling', entityId: filing._id.toString(), action: 'REQUEST_FILING_OTP', performedBy: actorId, after: { returnType: kind, period } });
    return { sentTo };
  }

  /** Final. The return must read as it did when saved; otherwise save it again first. */
  async file(orgId: string, actorId: string, kind: ReturnKind, period: string, otp: string) {
    const filing = await this.filing(orgId, kind, period);
    if (filing.status === 'filed') throw new ConflictException(`Already filed (ARN ${filing.arn}).`);
    if (filing.status !== 'otp_sent') throw new BadRequestException('Ask for the OTP first.');
    if (!/^\d{6}$/.test(otp ?? '')) throw new BadRequestException('Enter the six-digit OTP.');
    const { json } = await this.build(orgId, kind, period);
    if (this.hash(json) !== filing.payloadHash) {
      throw new BadRequestException('The books have changed since the return was saved. Save it again, check it, then file.');
    }
    const { arn, filedAt } = await this.call(() => this.gsp.fileReturn(filing.gstin, kind, period, otp));
    filing.set({ status: 'filed', arn, filedAt: new Date(filedAt), filedBy: actorId });
    await filing.save();
    await this.audit.record({ orgId, entityType: 'GstFiling', entityId: filing._id.toString(), action: 'FILE_RETURN', performedBy: actorId, before: { status: 'otp_sent' }, after: { returnType: kind, period, arn, test: this.gsp.isMock } });
    return filing;
  }

  /**
   * The month's GST set-off and payment as one voucher, from the 3B as saved:
   * output tax cleared against credit used and the cash paid by challan.
   */
  async recordPayment(orgId: string, actorId: string, period: string, input: { paidOn?: string; challanNo?: string | null }) {
    const filing = await this.filing(orgId, 'GSTR3B', period);
    if (filing.paymentJournalId) throw new ConflictException('The GST for this month is already recorded.');
    const date = input.paidOn ?? todayIst();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('paidOn must be a date like 2026-11-20');
    const setOff = (filing.snapshot as { setOff: Gstr3b['setOff'] }).setOff;
    const keys = {
      out: { igst: SystemAccountKey.GST_OUTPUT_IGST, cgst: SystemAccountKey.GST_OUTPUT_CGST, sgst: SystemAccountKey.GST_OUTPUT_SGST, cess: SystemAccountKey.GST_OUTPUT_CESS },
      in: { igst: SystemAccountKey.GST_INPUT_IGST, cgst: SystemAccountKey.GST_INPUT_CGST, sgst: SystemAccountKey.GST_INPUT_SGST, cess: SystemAccountKey.GST_INPUT_CESS },
    } as const;
    const accounts = await this.accounts.resolveSystemAccounts(orgId, [...Object.values(keys.out), ...Object.values(keys.in), SystemAccountKey.RCM_GST_PAYABLE, SystemAccountKey.BANK]);
    const line = (key: SystemAccountKey, debitPaise: number, creditPaise: number) => {
      const a = accounts.get(key)!;
      return { accountId: a._id.toString(), description: a.name, debitPaise, creditPaise };
    };
    const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number }> = [];
    const creditUsed = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    let reverseCharge = 0;
    for (const row of setOff.rows) {
      if (row.liabilityPaise > 0) lines.push(line(keys.out[row.head], row.liabilityPaise, 0));
      reverseCharge += row.reverseChargePaise;
      for (const [from, amount] of Object.entries(row.fromCredit) as Array<[keyof typeof creditUsed, number]>) creditUsed[from] += amount;
    }
    if (reverseCharge > 0) lines.push(line(SystemAccountKey.RCM_GST_PAYABLE, reverseCharge, 0));
    for (const head of ['igst', 'cgst', 'sgst', 'cess'] as const) if (creditUsed[head] > 0) lines.push(line(keys.in[head], 0, creditUsed[head]));
    if (setOff.cashTotalPaise > 0) lines.push(line(SystemAccountKey.BANK, 0, setOff.cashTotalPaise));
    if (lines.length === 0) throw new BadRequestException('Nothing to record: no tax was due this month.');

    const challan = input.challanNo?.trim() || null;
    const journal = await this.posting.inTransaction(async (session) => {
      const claimed = await withOrg(orgId, () => this.filingModel.findOneAndUpdate({ _id: filing._id, paymentJournalId: null }, { $set: { paymentJournalId: filing._id } }, { session }).exec());
      if (!claimed) throw new ConflictException('The GST for this month is already recorded.');
      const posted = await this.posting.post(
        {
          orgId,
          voucherType: VoucherType.JOURNAL,
          financialYear: financialYearOf(date),
          date,
          narration: `GST for ${period}: credit set off${setOff.cashTotalPaise > 0 ? `, paid in cash${challan ? ` (challan ${challan})` : ''}` : ''}`,
          postedBy: actorId,
          lines,
        },
        session,
      );
      await withOrg(orgId, () => this.filingModel.updateOne({ _id: filing._id }, { $set: { paymentJournalId: posted._id } }, { session }).exec());
      await this.audit.record({ orgId, entityType: 'GstFiling', entityId: filing._id.toString(), action: 'RECORD_GST_PAYMENT', performedBy: actorId, after: { period, journalId: posted._id.toString(), cashPaise: setOff.cashTotalPaise, challan } }, session);
      return posted;
    });
    return journal;
  }

  async gstr9(orgId: string, financialYear: string) {
    if (!/^\d{4}-\d{2}$/.test(financialYear ?? '')) throw new BadRequestException('financialYear must be like 2025-26');
    const months = monthsOf(financialYear);
    const data = await Promise.all(months.map(async (p) => ({ gstr1: await this.returns.gstr1(orgId, p), gstr3b: await this.returns.gstr3b(orgId, p) })));
    return buildGstr9(financialYear, data);
  }

  private async build(orgId: string, kind: ReturnKind, period: string): Promise<{ json: Record<string, unknown>; built: Gstr1 | Gstr3b }> {
    if (kind === 'GSTR1') {
      const built = await this.returns.gstr1(orgId, period);
      return { json: await this.returns.gstr1Json(orgId, period), built };
    }
    const built = await this.returns.gstr3b(orgId, period);
    return { json: await this.returns.gstr3bJson(orgId, period), built };
  }

  private snapshot(kind: ReturnKind, built: Gstr1 | Gstr3b): Record<string, unknown> {
    if (kind === 'GSTR1') return { summary: (built as Gstr1).summary };
    const r = built as Gstr3b;
    return { outwardTaxable: r.outwardTaxable, itcNet: r.itcNet, itcReversed: r.itcReversed, setOff: r.setOff };
  }

  private hash(json: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(json)).digest('hex');
  }

  private async filing(orgId: string, kind: ReturnKind, period: string): Promise<GstFilingDocument> {
    const filing = await this.filingModel.findOne({ orgId, returnType: kind, period }).exec();
    if (!filing) throw new NotFoundException(`Save ${this.label(kind)} for ${period} first.`);
    return filing;
  }

  private async gstin(orgId: string): Promise<string> {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const gstin = settings?.gstin?.trim().toUpperCase();
    if (!gstin) throw new BadRequestException('Enter your GSTIN in Settings → Business first.');
    return gstin;
  }

  private label(kind: ReturnKind) {
    return kind === 'GSTR1' ? 'GSTR-1' : 'GSTR-3B';
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GspRejected) throw new BadRequestException(`The GST portal refused it: ${err.errors.map((e) => `${e.message} (${e.code})`).join('; ')}`);
      throw err;
    }
  }
}

