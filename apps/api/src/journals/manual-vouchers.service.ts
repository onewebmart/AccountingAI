import { BadRequestException, HttpException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VoucherType } from '@ai-accounting/shared';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { formatVoucherNumber } from './journals.service';

export interface ManualVoucherLine {
  accountId: string;
  description?: string;
  debitPaise: number;
  creditPaise: number;
  projectId?: string | null;
  /** A customer or vendor the line is about. The name is filled in from the record. */
  contact?: { kind: 'customer' | 'vendor'; id: string; name?: string } | null;
}

export interface ManualVoucherInput {
  voucherType?: VoucherType;
  financialYear?: string;
  date?: string;
  /** Notes: why the entry is made. Required on a new journal, up to 500 characters. */
  narration?: string;
  /** Reference#: the person's own document or file number. */
  reference?: string | null;
  /** Journal# of the person's own, in place of the automatic one. The JNL voucher number is still allocated. */
  journalNumber?: string | null;
  /** Reverse Journal Date: after `date`. */
  reverseOn?: string | null;
  /**
   * "Publish reverse journal only on the reverse journal date". Ticked (the
   * default): the daily job posts the reversal on that date, and until then
   * it is not in the ledger. Unticked: the reversal is posted now with this
   * journal, dated the reverse date.
   */
  publishReversalOnDate?: boolean;
  lines: ManualVoucherLine[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The shape of a voucher number, such as JNL/2026-27/0004: not available as a Journal# of one's own. */
const VOUCHER_SHAPED = /^(PUR|SAL|RCT|PMT|CTR|JNL|CRN|DBN)\/\d{4}-\d{2}\/\d+$/i;

/**
 * Accounts kept party by party from documents. A manual journal line on one
 * would move the control account without moving any invoice, bill, advance
 * or claim, and the ageing would stop agreeing with the ledger. So they are
 * refused here, with the document that does the job instead.
 */
const PARTY_ACCOUNTS: Record<string, string> = {
  ACCOUNTS_RECEIVABLE:
    'is kept customer by customer from invoices, receipts and credit notes, so a journal cannot post to it (the receivables ageing would stop agreeing with it). Raise a credit note, record a receipt, or enter the amount in Opening Balances.',
  CUSTOMER_ADVANCES:
    "is kept customer by customer from the advances they paid, so a journal cannot post to it. Record the receipt as an advance, apply or refund it from the customer's page, or enter it in Opening Balances.",
  ACCOUNTS_PAYABLE:
    'is kept vendor by vendor from bills, payments and debit notes, so a journal cannot post to it (the payables ageing would stop agreeing with it). Raise a debit note, record a payment, or enter the amount in Opening Balances.',
  VENDOR_ADVANCES:
    "is kept vendor by vendor from the advances paid to them, so a journal cannot post to it. Record the payment as an advance, apply it from the vendor's page, or enter it in Opening Balances.",
  EMPLOYEE_PAYABLE: 'is kept claim by claim from expense claims, so a journal cannot post to it. Approve or pay the claim instead.',
};

/**
 * A voucher a person types. Under an approval policy for journals it waits
 * for approval, kept as it was entered, and posts in the approver's name.
 */
@Injectable()
export class ManualVouchersService implements OnModuleInit {
  constructor(
    private readonly posting: PostingService,
    @InjectModel(LedgerAccount.name) private readonly accountModel: Model<LedgerAccountDocument>,
    @InjectModel(Journal.name) private readonly journalModel: Model<JournalDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vendor.name) private readonly vendorModel: Model<VendorDocument>,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals?.register('journal', async (orgId, actorId, request) => {
      const journal = await this.postNow(orgId, actorId, (request.payload as { voucher: ManualVoucherInput }).voucher);
      return String(journal._id);
    });
  }

  async post(orgId: string, actorId: string, actorRole: string, body: ManualVoucherInput) {
    const voucher = await this.check(orgId, body, true);
    const amount = voucher.lines.reduce((s, l) => s + l.debitPaise, 0);
    if (this.approvals) {
      await this.approvals.gate({
        orgId, docType: 'journal', docId: null, payload: { kind: 'journal', voucher },
        summary: `${voucher.voucherType ?? VoucherType.JOURNAL} voucher — ${voucher.narration ?? ''}`.slice(0, 200), amountPaise: amount,
        makerId: actorId, actorId, actorRole, facts: { date: voucher.date!, amountPaise: amount },
      });
    }
    return this.postNow(orgId, actorId, voucher);
  }

  /**
   * Post the voucher, and its reversal too when it is to be published now.
   * Both commit in one transaction, or neither does.
   */
  private async postNow(orgId: string, actorId: string, body: ManualVoucherInput) {
    // Checked again: an approved request was checked when it was made, but a
    // Journal# may have been used, or an account changed, since.
    const v = await this.check(orgId, body, false);
    const date = v.date!;
    const autoReverse = v.reverseOn ? { on: v.reverseOn, publishOnDate: v.publishReversalOnDate !== false } : null;
    try {
      return await this.posting.inTransaction(async (session) => {
        const journal = await this.posting.post(
          {
            orgId,
            voucherType: v.voucherType ?? VoucherType.JOURNAL,
            financialYear: v.financialYear ?? financialYearOf(date),
            date,
            narration: v.narration,
            postedBy: actorId,
            reference: v.reference ?? null,
            journalNumber: v.journalNumber ?? null,
            autoReverse,
            lines: v.lines.map((l) => ({
              accountId: l.accountId,
              description: l.description,
              debitPaise: l.debitPaise,
              creditPaise: l.creditPaise,
              projectId: l.projectId ?? null,
              contact: l.contact ? { kind: l.contact.kind, id: l.contact.id, name: l.contact.name ?? '' } : null,
            })),
          },
          session,
        );
        if (autoReverse && !autoReverse.publishOnDate) {
          const number = formatVoucherNumber(journal.voucherType, journal.financialYear, journal.voucherNumber);
          await this.posting.reverse(String(journal._id), actorId, session, {
            date: autoReverse.on,
            narration: `Reversal of ${v.journalNumber ?? number}${v.narration ? `: ${v.narration}` : ''}`.slice(0, 500),
          });
        }
        return journal;
      });
    } catch (err: unknown) {
      const dup = err as { code?: number; keyPattern?: Record<string, unknown> } | null;
      if (dup?.code === 11000 && v.journalNumber && (!dup.keyPattern || 'journalNumber' in dup.keyPattern)) {
        throw new BadRequestException(`Journal# ${v.journalNumber} is already used. Choose another, or let the number be given automatically.`);
      }
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Everything about a typed voucher that can be wrong, checked before it
   * waits for approval or posts. Returns it tidied: trimmed text, the date,
   * and each contact's name.
   */
  private async check(orgId: string, body: ManualVoucherInput, isNew: boolean): Promise<ManualVoucherInput> {
    if (!body || !Array.isArray(body.lines) || body.lines.length < 2) throw new BadRequestException('A voucher needs at least two lines.');
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    if (!ISO_DATE.test(date)) throw new BadRequestException('The date must look like 2026-11-30.');

    const narration = typeof body.narration === 'string' ? body.narration.trim() : '';
    if (isNew && !narration) throw new BadRequestException('Add notes: say why this entry is made.');
    if (narration.length > 500) throw new BadRequestException('Notes can be at most 500 characters.');

    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (reference.length > 50) throw new BadRequestException('Reference# can be at most 50 characters.');

    const journalNumber = typeof body.journalNumber === 'string' ? body.journalNumber.trim() : '';
    if (journalNumber) {
      if (journalNumber.length > 30 || !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(journalNumber)) {
        throw new BadRequestException('A Journal# is up to 30 letters, digits, slashes, dots, dashes or underscores.');
      }
      if (VOUCHER_SHAPED.test(journalNumber)) {
        throw new BadRequestException(`${journalNumber} looks like a voucher number, which the books give out themselves. Choose another Journal#, or let it be given automatically.`);
      }
      if (await this.journalModel.exists({ orgId, journalNumber }).exec()) {
        throw new BadRequestException(`Journal# ${journalNumber} is already used. Choose another, or let the number be given automatically.`);
      }
    }

    const reverseOn = typeof body.reverseOn === 'string' && body.reverseOn.trim() ? body.reverseOn.trim() : null;
    if (reverseOn) {
      if (!ISO_DATE.test(reverseOn)) throw new BadRequestException('The reverse journal date must look like 2026-12-01.');
      if (reverseOn <= date) throw new BadRequestException('The reverse journal date must be after the journal date.');
    }

    const lines = body.lines.map((l, i) => {
      const n = i + 1;
      if (!l || typeof l.accountId !== 'string' || !Types.ObjectId.isValid(l.accountId)) throw new BadRequestException(`Line ${n}: choose an account.`);
      const dr = l.debitPaise ?? 0;
      const cr = l.creditPaise ?? 0;
      if (!Number.isInteger(dr) || !Number.isInteger(cr) || dr < 0 || cr < 0) throw new BadRequestException(`Line ${n}: amounts are whole paise, not negative.`);
      if ((dr > 0) === (cr > 0)) throw new BadRequestException(`Line ${n}: enter a debit or a credit, not both and not neither.`);
      const description = typeof l.description === 'string' ? l.description.trim().slice(0, 500) : undefined;
      const contact = l.contact ?? null;
      if (contact && (!['customer', 'vendor'].includes(contact.kind) || typeof contact.id !== 'string' || !Types.ObjectId.isValid(contact.id))) {
        throw new BadRequestException(`Line ${n}: choose the contact again.`);
      }
      return { accountId: l.accountId, description, debitPaise: dr, creditPaise: cr, projectId: l.projectId ?? null, contact };
    });

    // Accounts kept by party cannot take a manual line (see PARTY_ACCOUNTS).
    const accounts = await this.accountModel
      .find({ orgId, _id: { $in: [...new Set(lines.map((l) => l.accountId))] } }, { name: 1, systemKey: 1 })
      .lean()
      .exec();
    const byId = new Map(accounts.map((a) => [String(a._id), a]));
    lines.forEach((l, i) => {
      const a = byId.get(l.accountId);
      if (!a) throw new BadRequestException(`Line ${i + 1}: that account is not in your chart of accounts.`);
      const why = a.systemKey ? PARTY_ACCOUNTS[a.systemKey] : undefined;
      if (why) throw new BadRequestException(`Line ${i + 1}: ${a.name} ${why}`);
    });

    // Each contact is a customer or vendor of this org, named as it is now.
    const ids = (kind: 'customer' | 'vendor') => [...new Set(lines.filter((l) => l.contact?.kind === kind).map((l) => l.contact!.id))];
    const [customers, vendors] = await Promise.all([
      ids('customer').length ? this.customerModel.find({ orgId, _id: { $in: ids('customer') } }, { name: 1 }).lean().exec() : [],
      ids('vendor').length ? this.vendorModel.find({ orgId, _id: { $in: ids('vendor') } }, { name: 1 }).lean().exec() : [],
    ]);
    const names = new Map<string, string>([...customers.map((c) => [`customer:${c._id}`, c.name] as const), ...vendors.map((c) => [`vendor:${c._id}`, c.name] as const)]);
    const withContacts = lines.map((l, i) => {
      if (!l.contact) return { ...l, contact: null };
      const name = names.get(`${l.contact.kind}:${l.contact.id}`);
      if (name === undefined) throw new BadRequestException(`Line ${i + 1}: that ${l.contact.kind} is not in your books.`);
      return { ...l, contact: { kind: l.contact.kind, id: l.contact.id, name } };
    });

    return {
      voucherType: body.voucherType,
      financialYear: body.financialYear,
      date,
      narration: narration || undefined,
      reference: reference || null,
      journalNumber: journalNumber || null,
      reverseOn,
      publishReversalOnDate: body.publishReversalOnDate !== false,
      lines: withContacts,
    };
  }
}
