import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, VoucherType } from '@ai-accounting/shared';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PostingService } from '../gl/posting.service';
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
  financialYear: string | null;
  journalId: string | null;
  sourceDocumentId: string | null;
}

export interface CreateBillInput {
  orgId: string;
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
}

function getFY(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? `${y}-${(y + 1).toString().slice(-2)}` : `${y - 1}-${y.toString().slice(-2)}`;
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
  ) {}

  async create(input: CreateBillInput): Promise<PurchaseBillDocument> {
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
   *   Cr  Accounts Payable             (total)
   */
  async post(id: string, orgId: string, actorId: string): Promise<PurchaseBillDocument> {
    const bill = await this.findById(id, orgId);
    if (bill.status !== BillStatus.DRAFT) {
      throw new BadRequestException(`Bill is already ${bill.status}`);
    }

    const { taxableValue, cgst, sgst, igst, cess, total } = bill.amountsPaise;
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
    lines.push({
      accountId: payable._id.toString(),
      description: payable.name,
      debitPaise: 0,
      creditPaise: total,
    });

    const journal = await this.postingService.post({
      orgId,
      voucherType: VoucherType.PURCHASE,
      financialYear: fy,
      date: bill.billDate,
      narration: `Purchase bill ${bill.billNumber ?? bill._id.toString()} — vendor ${bill.vendorId}`,
      postedBy: actorId,
      lines,
    });

    const updated = await this.billModel
      .findByIdAndUpdate(
        id,
        { $set: { status: BillStatus.POSTED, journalId: journal._id, financialYear: fy, postedBy: actorId } },
        { new: true },
      )
      .exec();

    this.logger.log(`PurchaseBill ${id} posted → Journal ${journal._id}`);
    return updated!;
  }

  /** Record payment against a posted bill (creates a PAYMENT journal). */
  async markPaid(id: string, orgId: string, actorId: string): Promise<PurchaseBillDocument> {
    const bill = await this.findById(id, orgId);
    if (bill.status !== BillStatus.POSTED) {
      throw new BadRequestException(`Bill must be in POSTED status to mark as paid (current: ${bill.status})`);
    }

    const { total } = bill.amountsPaise;
    const fy = bill.financialYear ?? getFY(bill.billDate);

    const payAccountMap = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.ACCOUNTS_PAYABLE,
      SystemAccountKey.BANK,
    ]);
    const payAccounts = {
      payable: payAccountMap.get(SystemAccountKey.ACCOUNTS_PAYABLE)!,
      bank: payAccountMap.get(SystemAccountKey.BANK)!,
    };

    // Payment journal: Dr Accounts Payable / Cr Bank
    await this.postingService.post({
      orgId,
      voucherType: VoucherType.PAYMENT,
      financialYear: fy,
      date: new Date().toISOString().slice(0, 10),
      narration: `Payment for bill ${bill.billNumber ?? id}`,
      postedBy: actorId,
      lines: [
        { accountId: payAccounts.payable._id.toString(), description: payAccounts.payable.name, debitPaise: total, creditPaise: 0 },
        { accountId: payAccounts.bank._id.toString(), description: payAccounts.bank.name, debitPaise: 0, creditPaise: total },
      ],
    });

    const updated = await this.billModel
      .findByIdAndUpdate(id, { $set: { status: BillStatus.PAID, paidBy: actorId } }, { new: true })
      .exec();

    this.logger.log(`PurchaseBill ${id} marked PAID by ${actorId}`);
    return updated!;
  }
}
