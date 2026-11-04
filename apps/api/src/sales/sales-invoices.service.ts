import { partyAsIssued } from '../gl/party-as-issued';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { JournalDocument } from '../gl/schemas/journal.schema';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
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
  /** Paid so far, and what is still owed — integer paise. */
  amountPaidPaise: number;
  outstandingPaise: number;
  financialYear: string | null;
  journalId: string | null;
  sourceDocumentId: string | null;
  recurringTemplateId: string | null;
}

export interface CreateInvoiceInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
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
    itemId?: Types.ObjectId | null;
    uqc?: string | null;
    accountId?: Types.ObjectId | null;
    projectId?: Types.ObjectId | null;
  }>;
  notes?: string | null;
  /** Set when a recurring template drafts this invoice. */
  recurringTemplateId?: string | null;
  source?: { kind: 'quote' | 'sales_order' | 'project'; id: string; lines?: Array<{ orderLine: number; qty: number }> } | null;
  foreign?: SalesInvoice['foreign'];
  exportType?: 'lut' | null;
  shippingBill?: SalesInvoice['shippingBill'];
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

import { splitByAccount } from '../items/line-accounts';
@Injectable()
export class SalesInvoicesService {
  private readonly logger = new Logger(SalesInvoicesService.name);

  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    // Read-only: the list joins the customer's name onto each invoice.
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    private accountsService: AccountsService,
    private postingService: PostingService,
    private auditService: AuditService,
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
      recurringTemplateId: input.recurringTemplateId ? new Types.ObjectId(input.recurringTemplateId) : null,
      source: input.source ?? null,
      foreign: input.foreign ?? null,
      exportType: input.exportType ?? null,
      shippingBill: input.shippingBill ?? null,
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'SalesInvoice',
      entityId: invoice._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: { status: invoice.status, invoiceNumber: invoice.invoiceNumber, totalPaise: invoice.amountsPaise.total },
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
      const customer = partyAsIssued(i, customerById.get(i.customerId?.toString() ?? ''), 'Unknown customer');
      return {
        _id: i._id.toString(),
        customerId: i.customerId?.toString() ?? null,
        customerName: customer.name,
        customerGstin: customer.gstin,
        invoiceNumber: i.invoiceNumber ?? null,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate ?? null,
        status: i.status,
        amountsPaise: i.amountsPaise,
        totalPaise: i.amountsPaise?.total ?? 0,
        amountPaidPaise: i.amountPaidPaise ?? 0,
        outstandingPaise: outstandingPaise(i),
        financialYear: i.financialYear ?? null,
        journalId: i.journalId?.toString() ?? null,
        sourceDocumentId: i.sourceDocumentId?.toString() ?? null,
        recurringTemplateId: i.recurringTemplateId?.toString() ?? null,
        paymentLink: i.paymentLink
          ? { url: i.paymentLink.url, status: i.paymentLink.status, paidPaise: i.paymentLink.paidPaise, paidOn: i.paymentLink.paidOn }
          : null,
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
    await this.auditService.record({
      orgId,
      entityType: 'SalesInvoice',
      entityId: id,
      action: 'SEND',
      performedBy: actorId,
      before: { status: invoice.status },
      after: { status: InvoiceStatus.SENT },
    });

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
    if (invoice.isOpeningBalance) throw new BadRequestException('An opening balance is already in the books through the opening entry.');
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

    // Lines whose item has its own income account are credited there; the
    // rest go to Sales, in proportion, to the paise.
    const revenueParts = splitByAccount(taxableValue, invoice.lineItems, revenue._id.toString());
    const names = await this.accountsService.namesOf(orgId, revenueParts.map((p) => p.accountId));
    const lines = [
      {
        accountId: receivable._id.toString(),
        description: receivable.name,
        debitPaise: total,
        creditPaise: 0,
      },
      ...revenueParts.map((p) => ({
        accountId: p.accountId,
        description: names.get(p.accountId) ?? revenue.name,
        debitPaise: 0,
        creditPaise: p.amountPaise,
        projectId: p.projectId,
      })),
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

    const updated = await this.postingService.inTransaction(async (session) => {
      // Claim the transition before posting, in the same transaction, so a
      // second click finds nothing to claim instead of posting the sale twice.
      const claimed = await withOrg(orgId, () =>
        this.invoiceModel
          .findOneAndUpdate(
            { _id: id, status: { $in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] } },
            { $set: { status: InvoiceStatus.POSTED, financialYear: fy, postedBy: actorId } },
            { session },
          )
          .exec(),
      );
      if (!claimed) throw new BadRequestException('Invoice has already been posted');

      const journal = await this.postingService.post(
        {
          orgId,
          voucherType: VoucherType.SALES,
          financialYear: fy,
          date: invoice.invoiceDate,
          narration: `Sales invoice ${invoice.invoiceNumber ?? invoice._id.toString()} — customer ${invoice.customerId}`,
          postedBy: actorId,
          lines,
        },
        session,
      );

      await this.auditService.record(
        {
          orgId,
          entityType: 'SalesInvoice',
          entityId: id,
          action: 'POST',
          performedBy: actorId,
          before: { status: claimed.status },
          after: { status: InvoiceStatus.POSTED, journalId: journal._id.toString() },
        },
        session,
      );

      // An invoice typed without a number, or made from a recurring template,
      // takes the next serial for its year. The series is its own, not the
      // SALES voucher numbers, which scanned invoices also use, so it has no
      // gaps. A reversed and re-posted invoice keeps the number it had.
      const invoiceNumber =
        invoice.invoiceNumber ??
        `INV/${fy}/${String(await this.postingService.nextDocumentNumber(orgId, 'INVOICE_SERIAL', fy, session)).padStart(4, '0')}`;

      return this.invoiceModel
        .findByIdAndUpdate(id, { $set: { journalId: journal._id, invoiceNumber } }, { new: true, session })
        .exec();
    });

    this.logger.log(`SalesInvoice ${id} posted → Journal ${updated!.journalId}`);
    return updated!;
  }

  /**
   * Record a payment against a posted invoice — all of what is owed, or part of
   * it. `paidOn` is the day the money arrived (today when not given);
   * `amountPaise` defaults to everything still outstanding.
   */
  async markPaid(
    id: string,
    orgId: string,
    actorId: string,
    paidOn?: string,
    amountPaise?: number,
    tdsPaise?: number,
  ): Promise<SalesInvoiceDocument> {
    await this.findById(id, orgId); // 404 for an unknown invoice, before any transaction

    const { invoice: updated } = await this.postingService.inTransaction((session) =>
      this.settleWithin(session, id, orgId, actorId, {
        paidOn: paidOn ?? new Date().toISOString().slice(0, 10),
        amountPaise,
        tdsPaise,
      }),
    );

    this.logger.log(`SalesInvoice ${id} payment recorded by ${actorId} (now ${updated.status})`);
    return updated;
  }

  /**
   * Record a payment inside the caller's transaction: post the receipt
   * voucher dated `paidOn` (filed in that date's financial year), add it to
   * the invoice's payments, and mark the invoice paid once nothing is owed.
   *
   * The invoice is read and updated in the same transaction, guarded on the
   * amount paid so far, so two payments recorded at once cannot overpay it —
   * the second either sees the first or conflicts and retries. Bank
   * reconciliation calls this with the date and amount of the bank line.
   *
   * `tdsPaise` is tax the customer deducted at source: it settles the invoice
   * as surely as cash does, but goes to TDS Receivable — claimable against our
   * own tax — instead of the bank. A customer paying ₹9,000 on a ₹10,000 fee
   * after 10% TDS settles it in full.
   */
  async settleWithin(
    session: ClientSession,
    id: string,
    orgId: string,
    actorId: string,
    opts: { paidOn: string; amountPaise?: number; tdsPaise?: number; bankLineId?: string | null },
  ): Promise<{ invoice: SalesInvoiceDocument; receipt: JournalDocument }> {
    const current = await withOrg(orgId, () =>
      this.invoiceModel.findById(id).session(session).exec(),
    );
    if (!current) throw new NotFoundException('SalesInvoice not found');
    if (current.foreign) throw new BadRequestException(`This invoice is in ${current.foreign.currency}: record its payment in ${current.foreign.currency} with the rate, from the invoice, so the exchange difference is booked.`);
    if (current.status === InvoiceStatus.PAID) throw new BadRequestException('Invoice has already been marked paid');
    if (current.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException(`Invoice must be POSTED to record a payment (current: ${current.status})`);
    }

    const owed = outstandingPaise(current);
    const tds = opts.tdsPaise ?? 0;
    const amount = opts.amountPaise ?? owed - tds;
    if (!Number.isInteger(amount) || !Number.isInteger(tds) || amount < 0 || tds < 0 || amount + tds === 0) {
      throw new BadRequestException('A payment must be a positive whole number of paise');
    }
    if (amount + tds > owed) {
      throw new BadRequestException(
        `A payment of ${rupees(amount + tds)} is more than the ${rupees(owed)} still owed on this invoice`,
      );
    }

    const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
      SystemAccountKey.BANK,
      SystemAccountKey.ACCOUNTS_RECEIVABLE,
      SystemAccountKey.TDS_RECEIVABLE,
    ]);
    const bank = accounts.get(SystemAccountKey.BANK)!;
    const receivable = accounts.get(SystemAccountKey.ACCOUNTS_RECEIVABLE)!;
    const tdsReceivable = accounts.get(SystemAccountKey.TDS_RECEIVABLE)!;
    const settled = amount + tds;
    const number = current.invoiceNumber ?? id;

    const receipt = await this.postingService.post(
      {
        orgId,
        voucherType: VoucherType.RECEIPT,
        // Filed by its own date, not the invoice's — they differ for any
        // invoice paid after 31 March.
        financialYear: financialYearOf(opts.paidOn),
        date: opts.paidOn,
        narration:
          `Receipt for invoice ${number}` +
          (settled < owed ? ' (part)' : '') +
          (tds > 0 ? ` — ${rupees(tds)} TDS deducted by the customer` : ''),
        postedBy: actorId,
        lines: [
          ...(amount > 0
            ? [{ accountId: bank._id.toString(), description: bank.name, debitPaise: amount, creditPaise: 0 }]
            : []),
          ...(tds > 0
            ? [{ accountId: tdsReceivable._id.toString(), description: tdsReceivable.name, debitPaise: tds, creditPaise: 0 }]
            : []),
          { accountId: receivable._id.toString(), description: receivable.name, debitPaise: 0, creditPaise: settled },
        ],
      },
      session,
    );

    const paidInFull = settled === owed;
    const updated = await withOrg(orgId, () =>
      this.invoiceModel
        .findOneAndUpdate(
          { _id: current._id, status: InvoiceStatus.POSTED, amountPaidPaise: current.amountPaidPaise ?? 0 },
          {
            $inc: { amountPaidPaise: settled },
            $push: {
              payments: {
                journalId: receipt._id,
                amountPaise: amount,
                tdsPaise: tds,
                paidOn: opts.paidOn,
                bankLineId: opts.bankLineId ? new Types.ObjectId(opts.bankLineId) : null,
              },
            },
            $set: paidInFull ? { status: InvoiceStatus.PAID, paidBy: actorId } : {},
          },
          { new: true, session },
        )
        .exec(),
    );
    if (!updated) throw new BadRequestException('This invoice changed while the payment was being recorded — try again');

    await this.auditService.record(
      {
        orgId,
        entityType: 'SalesInvoice',
        entityId: id,
        action: paidInFull ? 'PAY' : 'PART_PAY',
        performedBy: actorId,
        before: { status: current.status, amountPaidPaise: current.amountPaidPaise ?? 0 },
        after: {
          status: updated.status,
          amountPaidPaise: updated.amountPaidPaise,
          receiptJournalId: receipt._id.toString(),
          paidOn: opts.paidOn,
        },
      },
      session,
    );

    return { invoice: updated, receipt };
  }
}
