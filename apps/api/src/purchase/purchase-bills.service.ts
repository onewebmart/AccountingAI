import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BillStatus, VoucherType } from '@ai-accounting/shared';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { JournalDocument } from '../gl/schemas/journal.schema';
import { outstandingPaise, payablePaise } from '../gl/schemas/settlement.schema';
import { TdsSection, defaultTdsRateBps, tdsOn } from '../gl/tds';
import { withOrg } from '../database/tenant.plugin';

/** The shape every list of bills is rendered from. */
export interface BillListItem {
  _id: string;
  vendorId: string | null;
  vendorName: string;
  vendorGstin: string | null;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  status: BillStatus;
  amountsPaise: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total: number;
  };
  /** amountsPaise.total, flattened — integer paise. */
  totalPaise: number;
  /** Paid so far, and what is still owed — integer paise. */
  amountPaidPaise: number;
  outstandingPaise: number;
  /** TDS withheld from the vendor, and whether GST is ours under reverse charge. */
  tdsPaise: number;
  tdsSection: string | null;
  isReverseCharge: boolean;
  financialYear: string | null;
  journalId: string | null;
  sourceDocumentId: string | null;
}

export interface CreateBillInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
  vendorId: string;
  billNumber?: string | null;
  billDate: string;
  dueDate?: string | null;
  amountsPaise: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total: number;
  };
  lineItems?: Array<{
    description: string;
    hsnSac?: string | null;
    qty?: number;
    ratePaise: number;
    amountPaise: number;
    taxRatePct?: number;
  }>;
  notes?: string | null;
  /** GST on this purchase is ours to pay (reverse charge). */
  isReverseCharge?: boolean;
  /** Overrides the vendor's TDS section; 'none' deducts nothing. */
  tdsSection?: string;
  tdsRateBps?: number;
}

function getFY(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? `${y}-${(y + 1).toString().slice(-2)}` : `${y - 1}-${y.toString().slice(-2)}`;
}

/** Rupees for a message, e.g. 1000000 → "₹10,000.00". */
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * TDS on a new bill: the bill's own section if given ('none' for none),
 * otherwise the vendor's. Deducted on the taxable value, never on GST.
 */
function billTds(
  input: { tdsSection?: string; tdsRateBps?: number },
  vendor: { tdsSection?: string | null; tdsRateBps?: number | null; pan?: string | null },
  taxablePaise: number,
): { section: string; rateBps: number; amountPaise: number; depositId: null } | null {
  if (input.tdsSection === 'none') return null;
  const section = input.tdsSection ?? vendor.tdsSection;
  if (!section) return null;
  const rateBps =
    input.tdsRateBps ??
    (section === vendor.tdsSection && vendor.tdsRateBps != null
      ? vendor.tdsRateBps
      : defaultTdsRateBps(section as TdsSection, vendor.pan));
  const amountPaise = tdsOn(taxablePaise, rateBps);
  return amountPaise > 0 ? { section, rateBps, amountPaise, depositId: null } : null;
}

@Injectable()
export class PurchaseBillsService {
  private readonly logger = new Logger(PurchaseBillsService.name);

  constructor(
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    // Read-only: the list joins the vendor's name onto each bill.
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    private postingService: PostingService,
    private accountsService: AccountsService,
    private auditService: AuditService,
  ) {}

  async create(input: CreateBillInput): Promise<PurchaseBillDocument> {
    const vendor = await withOrg(input.orgId, () => this.vendorModel.findById(input.vendorId).exec());
    if (!vendor) throw new NotFoundException('Vendor not found');
    const tds = billTds(input, vendor, input.amountsPaise.taxableValue);
    const bill = await this.billModel.create({
      orgId: input.orgId,
      vendorId: new Types.ObjectId(input.vendorId),
      billNumber: input.billNumber ?? null,
      billDate: input.billDate,
      dueDate: input.dueDate ?? null,
      status: BillStatus.DRAFT,
      amountsPaise: input.amountsPaise,
      lineItems: input.lineItems ?? [],
      notes: input.notes ?? null,
      isReverseCharge: input.isReverseCharge ?? false,
      tds,
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'PurchaseBill',
      entityId: bill._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: {
        status: bill.status,
        billNumber: bill.billNumber,
        totalPaise: bill.amountsPaise.total,
        tdsPaise: bill.tds?.amountPaise ?? 0,
        isReverseCharge: bill.isReverseCharge,
      },
    });
    this.logger.log(`Created PurchaseBill ${bill._id} (draft) for vendor ${input.vendorId}`);
    return bill;
  }

  /**
   * Bills for the Purchase screen.
   *
   * Returns a view model rather than the raw documents. A bill stores its
   * counterparty as `vendorId` and its money under `amountsPaise.total`, but
   * every list that shows one needs the vendor's name and a single total — so
   * the shape was flattened in the client instead, and when the client read
   * `totalPaise` and `vendorName` off a raw document it got undefined and
   * rendered "?" and ₹0.00 against a bill that was perfectly correct in the
   * database. Doing the join here means one shape, and it cannot drift.
   */
  async list(orgId: string, status?: BillStatus): Promise<BillListItem[]> {
    const filter = status ? { status } : {};
    const bills = await withOrg(orgId, () =>
      this.billModel.find(filter).sort({ billDate: -1 }).limit(200).exec(),
    );

    const vendorIds = [...new Set(bills.map((b) => b.vendorId?.toString()).filter(Boolean))];
    const vendors = vendorIds.length
      ? await withOrg(orgId, () =>
          this.vendorModel.find({ _id: { $in: vendorIds } }).select('name gstin').exec(),
        )
      : [];
    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));

    return bills.map((b) => {
      const vendor = vendorById.get(b.vendorId?.toString() ?? '');
      return {
        _id: b._id.toString(),
        vendorId: b.vendorId?.toString() ?? null,
        vendorName: vendor?.name ?? 'Unknown vendor',
        vendorGstin: vendor?.gstin ?? null,
        billNumber: b.billNumber ?? null,
        billDate: b.billDate,
        dueDate: b.dueDate ?? null,
        status: b.status,
        amountsPaise: b.amountsPaise,
        totalPaise: b.amountsPaise?.total ?? 0,
        amountPaidPaise: b.amountPaidPaise ?? 0,
        outstandingPaise: outstandingPaise(b),
        tdsPaise: b.tds?.amountPaise ?? 0,
        tdsSection: b.tds?.section ?? null,
        isReverseCharge: b.isReverseCharge ?? false,
        financialYear: b.financialYear ?? null,
        journalId: b.journalId?.toString() ?? null,
        // Null for a manual entry; set when the bill was read off an upload.
        sourceDocumentId: b.sourceDocumentId?.toString() ?? null,
      };
    });
  }

  async findById(id: string, orgId: string): Promise<PurchaseBillDocument> {
    const bill = await withOrg(orgId, () => this.billModel.findById(id).exec());
    if (!bill) throw new NotFoundException('PurchaseBill not found');
    return bill;
  }

  /**
   * Post a draft bill to the ledger via PostingService (Invariant 4).
   *
   * Journal entries:
   *   Dr  Purchase / Expense Account   (taxableValue)
   *   Dr  GST Input Tax Credit         (cgst + sgst + igst + cess)
   *   Cr  Accounts Payable             (what the vendor is owed, less TDS)
   *   Cr  TDS Payable                  (TDS withheld, if any)
   *   Cr  GST Payable (Reverse Charge) (the tax, under reverse charge)
   */
  async post(id: string, orgId: string, actorId: string): Promise<PurchaseBillDocument> {
    const bill = await this.findById(id, orgId);
    if (bill.status !== BillStatus.DRAFT) {
      throw new BadRequestException(`Bill is already ${bill.status}`);
    }

    const { taxableValue, cgst, sgst, igst, cess } = bill.amountsPaise;
    const fy = getFY(bill.billDate);

    // Real accounts from this org's chart, resolved by their stable system key.
    // These lines used to carry `new Types.ObjectId()` — a fresh, random id per
    // posting — so a manually entered bill hit a ledger account that existed
    // nowhere, a different one each time. The amounts were right and the journal
    // balanced, which is why it looked fine; but the Chart of accounts never saw
    // them, and a per-account total could never agree with the sub-ledger.
    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.PURCHASE_EXPENSE,
      SystemAccountKey.ACCOUNTS_PAYABLE,
      SystemAccountKey.GST_INPUT_CGST,
      SystemAccountKey.GST_INPUT_SGST,
      SystemAccountKey.GST_INPUT_IGST,
      SystemAccountKey.GST_INPUT_CESS,
      SystemAccountKey.TDS_PAYABLE,
      SystemAccountKey.RCM_GST_PAYABLE,
    ]);
    const expense = accounts.get(SystemAccountKey.PURCHASE_EXPENSE)!;
    const payable = accounts.get(SystemAccountKey.ACCOUNTS_PAYABLE)!;
    const inputCgst = accounts.get(SystemAccountKey.GST_INPUT_CGST)!;
    const inputSgst = accounts.get(SystemAccountKey.GST_INPUT_SGST)!;
    const inputIgst = accounts.get(SystemAccountKey.GST_INPUT_IGST)!;
    const inputCess = accounts.get(SystemAccountKey.GST_INPUT_CESS)!;

    const lines = [
      {
        accountId: expense._id.toString(),
        description: expense.name,
        debitPaise: taxableValue,
        creditPaise: 0,
      },
    ];
    // Each tax head posts to its own account, as the return expects — lumping
    // them into one "GST Input Tax Credit" line loses the CGST/SGST/IGST split.
    for (const [account, amount] of [
      [inputCgst, cgst],
      [inputSgst, sgst],
      [inputIgst, igst],
      [inputCess, cess],
    ] as const) {
      if (amount > 0) {
        lines.push({
          accountId: account._id.toString(),
          description: account.name,
          debitPaise: amount,
          creditPaise: 0,
        });
      }
    }
    // The vendor is owed the total — the taxable value only under reverse
    // charge — less any TDS, which is owed to the government instead.
    const tdsPaise = bill.tds?.amountPaise ?? 0;
    const taxPaise = cgst + sgst + igst + cess;
    lines.push({
      accountId: payable._id.toString(),
      description: payable.name,
      debitPaise: 0,
      creditPaise: payablePaise(bill) - tdsPaise,
    });
    if (tdsPaise > 0) {
      const tdsAccount = accounts.get(SystemAccountKey.TDS_PAYABLE)!;
      lines.push({ accountId: tdsAccount._id.toString(), description: tdsAccount.name, debitPaise: 0, creditPaise: tdsPaise });
    }
    if (bill.isReverseCharge && taxPaise > 0) {
      const rcm = accounts.get(SystemAccountKey.RCM_GST_PAYABLE)!;
      lines.push({ accountId: rcm._id.toString(), description: rcm.name, debitPaise: 0, creditPaise: taxPaise });
    }

    const updated = await this.postingService.inTransaction(async (session) => {
      // Claim the transition before posting, in the same transaction, so a
      // second click finds nothing to claim instead of posting the bill twice.
      const claimed = await withOrg(orgId, () =>
        this.billModel
          .findOneAndUpdate(
            { _id: id, status: BillStatus.DRAFT },
            { $set: { status: BillStatus.POSTED, financialYear: fy, postedBy: actorId } },
            { session },
          )
          .exec(),
      );
      if (!claimed) throw new BadRequestException('Bill has already been posted');

      const journal = await this.postingService.post(
        {
          orgId,
          voucherType: VoucherType.PURCHASE,
          financialYear: fy,
          date: bill.billDate,
          narration: `Purchase bill ${bill.billNumber ?? bill._id.toString()} — vendor ${bill.vendorId}`,
          postedBy: actorId,
          lines,
        },
        session,
      );

      await this.auditService.record(
        {
          orgId,
          entityType: 'PurchaseBill',
          entityId: id,
          action: 'POST',
          performedBy: actorId,
          before: { status: BillStatus.DRAFT },
          after: { status: BillStatus.POSTED, journalId: journal._id.toString() },
        },
        session,
      );

      return this.billModel
        .findByIdAndUpdate(id, { $set: { journalId: journal._id } }, { new: true, session })
        .exec();
    });

    this.logger.log(`PurchaseBill ${id} posted → Journal ${updated!.journalId}`);
    return updated!;
  }

  /**
   * Record a payment against a posted bill — all of what is owed, or part of
   * it. `paidOn` is the day the money left (today when not given);
   * `amountPaise` defaults to everything still outstanding.
   */
  async markPaid(
    id: string,
    orgId: string,
    actorId: string,
    paidOn?: string,
    amountPaise?: number,
  ): Promise<PurchaseBillDocument> {
    await this.findById(id, orgId); // 404 for an unknown bill, before any transaction

    const { bill: updated } = await this.postingService.inTransaction((session) =>
      this.settleWithin(session, id, orgId, actorId, {
        paidOn: paidOn ?? new Date().toISOString().slice(0, 10),
        amountPaise,
      }),
    );

    this.logger.log(`PurchaseBill ${id} payment recorded by ${actorId} (now ${updated.status})`);
    return updated;
  }

  /**
   * Record a payment inside the caller's transaction: post the payment
   * voucher dated `paidOn` (filed in that date's financial year), add it to
   * the bill's payments, and mark the bill paid once nothing is owed.
   *
   * The bill is read and updated in the same transaction, guarded on the
   * amount paid so far, so two payments recorded at once cannot overpay it —
   * the second either sees the first or conflicts and retries. Bank
   * reconciliation calls this with the date and amount of the bank line.
   */
  async settleWithin(
    session: ClientSession,
    id: string,
    orgId: string,
    actorId: string,
    opts: { paidOn: string; amountPaise?: number; bankLineId?: string | null },
  ): Promise<{ bill: PurchaseBillDocument; payment: JournalDocument }> {
    const current = await withOrg(orgId, () =>
      this.billModel.findById(id).session(session).exec(),
    );
    if (!current) throw new NotFoundException('PurchaseBill not found');
    if (current.status === BillStatus.PAID) throw new BadRequestException('Bill has already been marked paid');
    if (current.status !== BillStatus.POSTED) {
      throw new BadRequestException(`Bill must be POSTED to record a payment (current: ${current.status})`);
    }

    const owed = outstandingPaise(current);
    const amount = opts.amountPaise ?? owed;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException('A payment must be a positive whole number of paise');
    }
    if (amount > owed) {
      throw new BadRequestException(
        `A payment of ${rupees(amount)} is more than the ${rupees(owed)} still owed on this bill`,
      );
    }

    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.ACCOUNTS_PAYABLE,
      SystemAccountKey.BANK,
    ]);
    const payable = accounts.get(SystemAccountKey.ACCOUNTS_PAYABLE)!;
    const bank = accounts.get(SystemAccountKey.BANK)!;
    const number = current.billNumber ?? id;

    const payment = await this.postingService.post(
      {
        orgId,
        voucherType: VoucherType.PAYMENT,
        // Filed by its own date, not the bill's — they differ for any
        // bill paid after 31 March.
        financialYear: financialYearOf(opts.paidOn),
        date: opts.paidOn,
        narration: amount < owed ? `Payment for bill ${number} (part)` : `Payment for bill ${number}`,
        postedBy: actorId,
        lines: [
          { accountId: payable._id.toString(), description: payable.name, debitPaise: amount, creditPaise: 0 },
          { accountId: bank._id.toString(), description: bank.name, debitPaise: 0, creditPaise: amount },
        ],
      },
      session,
    );

    const paidInFull = amount === owed;
    const updated = await withOrg(orgId, () =>
      this.billModel
        .findOneAndUpdate(
          { _id: current._id, status: BillStatus.POSTED, amountPaidPaise: current.amountPaidPaise ?? 0 },
          {
            $inc: { amountPaidPaise: amount },
            $push: {
              payments: {
                journalId: payment._id,
                amountPaise: amount,
                paidOn: opts.paidOn,
                bankLineId: opts.bankLineId ? new Types.ObjectId(opts.bankLineId) : null,
              },
            },
            $set: paidInFull ? { status: BillStatus.PAID, paidBy: actorId } : {},
          },
          { new: true, session },
        )
        .exec(),
    );
    if (!updated) throw new BadRequestException('This bill changed while the payment was being recorded — try again');

    await this.auditService.record(
      {
        orgId,
        entityType: 'PurchaseBill',
        entityId: id,
        action: paidInFull ? 'PAY' : 'PART_PAY',
        performedBy: actorId,
        before: { status: current.status, amountPaidPaise: current.amountPaidPaise ?? 0 },
        after: {
          status: updated.status,
          amountPaidPaise: updated.amountPaidPaise,
          paymentJournalId: payment._id.toString(),
          paidOn: opts.paidOn,
        },
      },
      session,
    );

    return { bill: updated, payment };
  }
}
