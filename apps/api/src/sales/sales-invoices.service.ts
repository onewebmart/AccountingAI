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
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PostingService } from '../gl/posting.service';
import { withOrg } from '../database/tenant.plugin';

/** The shape every list of sales invoices is rendered from. */
export interface InvoiceListItem {
  _id: string;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
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
    // Read-only: the list joins the customer's name onto each invoice.
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    private accountsService: AccountsService,
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

  /**
   * Invoices for the Sales screen — a view model, not the raw documents.
   *
   * Same reasoning as the purchase list: an invoice stores `customerId` and
   * `amountsPaise.total`, while every list of them needs a name and one total.
   * Joining here means the screen and the sub-ledger cannot disagree.
   */
  async list(orgId: string, status?: InvoiceStatus): Promise<InvoiceListItem[]> {
    const filter = status ? { status } : {};
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel.find(filter).sort({ invoiceDate: -1 }).limit(200).exec(),
    );

    const customerIds = [
      ...new Set(invoices.map((i) => i.customerId?.toString()).filter(Boolean)),
    ];
    const customers = customerIds.length
      ? await withOrg(orgId, () =>
          this.customerModel.find({ _id: { $in: customerIds } }).select('name gstin').exec(),
        )
      : [];
    const customerById = new Map(customers.map((c) => [c._id.toString(), c]));

    return invoices.map((i) => {
      const customer = customerById.get(i.customerId?.toString() ?? '');
      return {
        _id: i._id.toString(),
        customerId: i.customerId?.toString() ?? null,
        customerName: customer?.name ?? 'Unknown customer',
        customerGstin: customer?.gstin ?? null,
        invoiceNumber: i.invoiceNumber ?? null,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate ?? null,
        status: i.status,
        amountsPaise: i.amountsPaise,
        totalPaise: i.amountsPaise?.total ?? 0,
        financialYear: i.financialYear ?? null,
        journalId: i.journalId?.toString() ?? null,
        sourceDocumentId: i.sourceDocumentId?.toString() ?? null,
      };
    });
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
    const fy = getFY(invoice.invoiceDate);

    // Real accounts from this org's chart. These lines used to carry a fresh
    // `new Types.ObjectId()` per posting, so a manually entered invoice hit a
    // ledger account that existed nowhere and the Chart of accounts never saw
    // it — see the matching note in PurchaseBillsService.
    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.ACCOUNTS_RECEIVABLE,
      SystemAccountKey.SALES_REVENUE,
      SystemAccountKey.GST_OUTPUT_CGST,
      SystemAccountKey.GST_OUTPUT_SGST,
      SystemAccountKey.GST_OUTPUT_IGST,
      SystemAccountKey.GST_OUTPUT_CESS,
    ]);
    const receivable = accounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!;
    const revenue = accounts.get(SystemAccountKey.SALES_REVENUE)!;
    const outCgst = accounts.get(SystemAccountKey.GST_OUTPUT_CGST)!;
    const outSgst = accounts.get(SystemAccountKey.GST_OUTPUT_SGST)!;
    const outIgst = accounts.get(SystemAccountKey.GST_OUTPUT_IGST)!;
    const outCess = accounts.get(SystemAccountKey.GST_OUTPUT_CESS)!;

    const lines = [
      {
        accountId: receivable._id.toString(),
        description: receivable.name,
        debitPaise: total,
        creditPaise: 0,
      },
      {
        accountId: revenue._id.toString(),
        description: revenue.name,
        debitPaise: 0,
        creditPaise: taxableValue,
      },
    ];
    // One line per tax head, as the return expects.
    for (const [account, amount] of [
      [outCgst, cgst],
      [outSgst, sgst],
      [outIgst, igst],
      [outCess, cess],
    ] as const) {
      if (amount > 0) {
        lines.push({
          accountId: account._id.toString(),
          description: account.name,
          debitPaise: 0,
          creditPaise: amount,
        });
      }
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

    const receiptAccounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.BANK,
      SystemAccountKey.ACCOUNTS_RECEIVABLE,
    ]);
    const bank = receiptAccounts.get(SystemAccountKey.BANK)!;
    const receivable = receiptAccounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!;

    // Receipt journal: Dr Bank / Cr Accounts Receivable
    await this.postingService.post({
      orgId,
      voucherType: VoucherType.RECEIPT,
      financialYear: fy,
      date: new Date().toISOString().slice(0, 10),
      narration: `Receipt for invoice ${invoice.invoiceNumber ?? id}`,
      postedBy: actorId,
      lines: [
        { accountId: bank._id.toString(), description: bank.name, debitPaise: total, creditPaise: 0 },
        { accountId: receivable._id.toString(), description: receivable.name, debitPaise: 0, creditPaise: total },
      ],
    });

    const updated = await this.invoiceModel
      .findByIdAndUpdate(id, { $set: { status: InvoiceStatus.PAID, paidBy: actorId } }, { new: true })
      .exec();

    this.logger.log(`SalesInvoice ${id} marked PAID by ${actorId}`);
    return updated!;
  }
}
