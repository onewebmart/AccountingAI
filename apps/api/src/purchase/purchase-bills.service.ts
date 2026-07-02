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
import { PostingService } from '../gl/posting.service';
import { withOrg } from '../database/tenant.plugin';

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
    private postingService: PostingService,
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

  async list(orgId: string, status?: BillStatus): Promise<PurchaseBillDocument[]> {
    const filter = status ? { status } : {};
    return withOrg(orgId, () =>
      this.billModel.find(filter).sort({ billDate: -1 }).limit(200).exec(),
    );
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
    const gstTotal = cgst + sgst + igst + cess;
    const fy = getFY(bill.billDate);

    const lines = [
      {
        accountId: new Types.ObjectId().toString(),
        description: 'Purchase / Expense Account',
        debitPaise: taxableValue,
        creditPaise: 0,
      },
    ];
    if (gstTotal > 0) {
      lines.push({
        accountId: new Types.ObjectId().toString(),
        description: 'GST Input Tax Credit',
        debitPaise: gstTotal,
        creditPaise: 0,
      });
    }
    lines.push({
      accountId: new Types.ObjectId().toString(),
      description: 'Accounts Payable',
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

    // Payment journal: Dr Accounts Payable / Cr Bank
    await this.postingService.post({
      orgId,
      voucherType: VoucherType.PAYMENT,
      financialYear: fy,
      date: new Date().toISOString().slice(0, 10),
      narration: `Payment for bill ${bill.billNumber ?? id}`,
      postedBy: actorId,
      lines: [
        { accountId: new Types.ObjectId().toString(), description: 'Accounts Payable', debitPaise: total, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), description: 'Bank / Cash Account', debitPaise: 0, creditPaise: total },
      ],
    });

    const updated = await this.billModel
      .findByIdAndUpdate(id, { $set: { status: BillStatus.PAID, paidBy: actorId } }, { new: true })
      .exec();

    this.logger.log(`PurchaseBill ${id} marked PAID by ${actorId}`);
    return updated!;
  }
}
