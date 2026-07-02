import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { PostingService } from '../gl/posting.service';
import { withOrg } from '../database/tenant.plugin';

export interface CreateInvoiceInput {
  orgId: string;
  customerId: string;
  invoiceNumber?: string | null;
  invoiceDate: string;
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
export class SalesInvoicesService {
  private readonly logger = new Logger(SalesInvoicesService.name);

  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    private postingService: PostingService,
  ) {}

  async create(input: CreateInvoiceInput): Promise<SalesInvoiceDocument> {
    const invoice = await this.invoiceModel.create({
      orgId: input.orgId,
      customerId: new Types.ObjectId(input.customerId),
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      status: InvoiceStatus.DRAFT,
      amountsPaise: input.amountsPaise,
      lineItems: input.lineItems ?? [],
      notes: input.notes ?? null,
    });
    this.logger.log(`Created SalesInvoice ${invoice._id} (draft) for customer ${input.customerId}`);
    return invoice;
  }

  async list(orgId: string, status?: InvoiceStatus): Promise<SalesInvoiceDocument[]> {
    const filter = status ? { status } : {};
    return withOrg(orgId, () =>
      this.invoiceModel.find(filter).sort({ invoiceDate: -1 }).limit(200).exec(),
    );
  }

  async findById(id: string, orgId: string): Promise<SalesInvoiceDocument> {
    const invoice = await withOrg(orgId, () => this.invoiceModel.findById(id).exec());
    if (!invoice) throw new NotFoundException('SalesInvoice not found');
    return invoice;
  }

  /**
   * Mark invoice as sent to the customer.
   * Button: "Send invoice" → toast: "Invoice sent" (design system §9.10).
   */
  async send(id: string, orgId: string, actorId: string): Promise<SalesInvoiceDocument> {
    const invoice = await this.findById(id, orgId);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(`Only draft invoices can be sent (current: ${invoice.status})`);
    }

    const updated = await this.invoiceModel
      .findByIdAndUpdate(
        id,
        { $set: { status: InvoiceStatus.SENT, sentAt: new Date() } },
        { new: true },
      )
      .exec();

    this.logger.log(`SalesInvoice ${id} sent by ${actorId}`);
    return updated!;
  }

  /**
   * Post a draft or sent invoice to the ledger via PostingService (Invariant 4).
   *
   * Journal entries:
   *   Dr  Accounts Receivable          (total)
   *   Cr  Sales / Revenue Account      (taxableValue)
   *   Cr  GST Output Tax               (cgst + sgst + igst + cess)
   */
  async post(id: string, orgId: string, actorId: string): Promise<SalesInvoiceDocument> {
    const invoice = await this.findById(id, orgId);
    if (![InvoiceStatus.DRAFT, InvoiceStatus.SENT].includes(invoice.status)) {
      throw new BadRequestException(`Invoice is already ${invoice.status}`);
    }

    const { taxableValue, cgst, sgst, igst, cess, total } = invoice.amountsPaise;
    const gstTotal = cgst + sgst + igst + cess;
    const fy = getFY(invoice.invoiceDate);

    const lines = [
      {
        accountId: new Types.ObjectId().toString(),
        description: 'Accounts Receivable',
        debitPaise: total,
        creditPaise: 0,
      },
      {
        accountId: new Types.ObjectId().toString(),
        description: 'Sales / Revenue Account',
        debitPaise: 0,
        creditPaise: taxableValue,
      },
    ];
    if (gstTotal > 0) {
      lines.push({
        accountId: new Types.ObjectId().toString(),
        description: 'GST Output Tax',
        debitPaise: 0,
        creditPaise: gstTotal,
      });
    }

    const journal = await this.postingService.post({
      orgId,
      voucherType: VoucherType.SALES,
      financialYear: fy,
      date: invoice.invoiceDate,
      narration: `Sales invoice ${invoice.invoiceNumber ?? invoice._id.toString()} — customer ${invoice.customerId}`,
      postedBy: actorId,
      lines,
    });

    const updated = await this.invoiceModel
      .findByIdAndUpdate(
        id,
        { $set: { status: InvoiceStatus.POSTED, journalId: journal._id, financialYear: fy, postedBy: actorId } },
        { new: true },
      )
      .exec();

    this.logger.log(`SalesInvoice ${id} posted → Journal ${journal._id}`);
    return updated!;
  }

  /** Record receipt of payment against a posted invoice (creates a RECEIPT journal). */
  async markPaid(id: string, orgId: string, actorId: string): Promise<SalesInvoiceDocument> {
    const invoice = await this.findById(id, orgId);
    if (invoice.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException(`Invoice must be POSTED to mark as paid (current: ${invoice.status})`);
    }

    const { total } = invoice.amountsPaise;
    const fy = invoice.financialYear ?? getFY(invoice.invoiceDate);

    // Receipt journal: Dr Bank / Cr Accounts Receivable
    await this.postingService.post({
      orgId,
      voucherType: VoucherType.RECEIPT,
      financialYear: fy,
      date: new Date().toISOString().slice(0, 10),
      narration: `Receipt for invoice ${invoice.invoiceNumber ?? id}`,
      postedBy: actorId,
      lines: [
        { accountId: new Types.ObjectId().toString(), description: 'Bank / Cash Account', debitPaise: total, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), description: 'Accounts Receivable', debitPaise: 0, creditPaise: total },
      ],
    });

    const updated = await this.invoiceModel
      .findByIdAndUpdate(id, { $set: { status: InvoiceStatus.PAID, paidBy: actorId } }, { new: true })
      .exec();

    this.logger.log(`SalesInvoice ${id} marked PAID by ${actorId}`);
    return updated!;
  }
}
