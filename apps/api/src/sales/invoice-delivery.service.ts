import { Optional, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { partyAsIssued } from '../gl/party-as-issued';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { MailerService } from '../mail/mailer.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { InvoicePdfData, renderInvoicePdf } from './invoice-pdf';

export interface EmailInvoiceInput {
  /** Defaults to the customer's email. */
  to?: string | null;
  cc?: string[];
  /** A note above the standard wording. */
  message?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const rupees = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * An invoice as the customer sees it: a PDF, and that PDF by email. "Send
 * invoice" used to change a status and nothing reached the customer.
 */
import * as qrcode from 'qrcode';
import { EInvoice, EInvoiceDocument } from '../einvoice/schemas/e-invoice.schema';
@Injectable()
export class InvoiceDeliveryService {
  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    private mailer: MailerService,
    private audit: AuditService,
    // Optional so specs that build this by hand need not register it.
    @Optional() @InjectModel(EInvoice.name) private einvoiceModel?: Model<EInvoiceDocument>,
  ) {}

  async pdf(orgId: string, id: string): Promise<{ filename: string; content: Buffer }> {
    const { invoice, data } = await this.load(orgId, id);
    return { filename: `Invoice-${(invoice.invoiceNumber ?? 'draft').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content: renderInvoicePdf(data) };
  }

  /**
   * Email the PDF to the customer. It must carry its number: an unnumbered
   * draft gets one when posted, and a tax invoice without one is no invoice.
   * Emailing a draft marks it sent, as "Send invoice" does.
   */
  async email(orgId: string, actorId: string, id: string, input: EmailInvoiceInput) {
    const { invoice, customer, data } = await this.load(orgId, id);
    if (!invoice.invoiceNumber) throw new BadRequestException('Post the invoice first: it gets its number then, and the customer needs it.');
    const to = (input.to ?? customer?.email ?? '').trim();
    if (!to) throw new BadRequestException(`${customer?.name ?? 'This customer'} has no email address. Add one, or type it in.`);
    const cc = (input.cc ?? []).map((c) => c.trim()).filter(Boolean);
    for (const address of [to, ...cc]) {
      if (!EMAIL.test(address)) throw new BadRequestException(`${address} is not an email address.`);
    }
    if (!this.mailer.configured) {
      throw new BadRequestException(
        'Email is not set up on this server (SMTP_HOST, SMTP_USER, SMTP_PASS), so nothing was sent. Download the PDF and send it yourself for now.',
      );
    }

    const owed = outstandingPaise(invoice);
    const text = [
      `Dear ${data.buyer.name},`,
      '',
      ...(input.message?.trim() ? [input.message.trim(), ''] : []),
      `Please find attached invoice ${invoice.invoiceNumber} dated ${data.date.split('-').reverse().join('/')} for ${rupees(invoice.amountsPaise.total)}.`,
      owed > 0 && invoice.dueDate ? `${rupees(owed)} is due by ${invoice.dueDate.split('-').reverse().join('/')}.` : owed > 0 ? `${rupees(owed)} is due.` : 'It has been paid in full. Thank you.',
      ...(owed > 0 && invoice.paymentLink?.status === 'created' ? ['', `Pay online: ${invoice.paymentLink.url}`] : []),
      ...(data.footer ? ['', data.footer] : []),
      '',
      'Regards,',
      data.seller.name,
    ].join('\n');

    const { messageId } = await this.mailer.send({
      to,
      cc,
      replyTo: data.seller.email,
      fromName: data.seller.name,
      subject: `Invoice ${invoice.invoiceNumber} from ${data.seller.name}`,
      text,
      attachments: [{ filename: `Invoice-${invoice.invoiceNumber.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content: renderInvoicePdf(data), contentType: 'application/pdf' }],
    });

    const set: Record<string, unknown> = { emailedTo: to, emailedAt: new Date() };
    if (invoice.status === InvoiceStatus.DRAFT) Object.assign(set, { status: InvoiceStatus.SENT, sentAt: new Date() });
    await this.invoiceModel.updateOne({ _id: invoice._id, orgId }, { $set: set }).exec();
    await this.audit.record({
      orgId,
      entityType: 'SalesInvoice',
      entityId: id,
      action: 'EMAIL',
      performedBy: actorId,
      before: { status: invoice.status },
      after: { status: set.status ?? invoice.status, emailedTo: to },
      meta: { cc, messageId },
    });
    return { emailedTo: to, cc, messageId };
  }

  /** The registered e-invoice, its QR read into modules for the PDF. */
  private async einvoiceFor(orgId: string, invoiceId: Types.ObjectId): Promise<InvoicePdfData['einvoice']> {
    const e = this.einvoiceModel ? await this.einvoiceModel.findOne({ orgId, invoiceId, status: 'active' }).lean().exec() : null;
    if (!e?.irn || !e.signedQrCode || !e.ackNo) return null;
    const { modules } = qrcode.create(e.signedQrCode, { errorCorrectionLevel: 'L' });
    const qr = Array.from({ length: modules.size }, (_, r) => Array.from({ length: modules.size }, (_, c) => !!modules.get(r, c)));
    const at = e.ackDate ? new Date(new Date(e.ackDate).getTime() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 19) : '';
    return { irn: e.irn, ackNo: e.ackNo, ackDate: at, qr, test: e.isTest };
  }

  private async load(orgId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Invoice not found');
    const invoice = await this.invoiceModel.findOne({ _id: id, orgId }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found');
    const [customer, settings] = await Promise.all([
      this.customerModel.findOne({ _id: invoice.customerId, orgId }).lean().exec(),
      this.settingsModel.findOne({ orgId }).lean().exec(),
    ]);
    const buyer = partyAsIssued(invoice, customer, 'Customer');
    const sellerGstin = settings?.gstin?.trim().toUpperCase() || null;
    const data: InvoicePdfData = {
      seller: {
        name: settings?.displayName?.trim() || 'Your business',
        address: settings?.address ?? null,
        gstin: sellerGstin,
        pan: settings?.pan ?? null,
        stateCode: sellerGstin?.slice(0, 2) ?? settings?.stateCode ?? null,
        phone: settings?.phone ?? null,
        email: settings?.email ?? null,
      },
      buyer: { name: buyer.name, address: customer?.address ?? null, gstin: buyer.gstin, stateCode: buyer.stateCode },
      number: invoice.invoiceNumber ?? null,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate ?? null,
      // Each line at its taxable value: its amount less its share of any discount (rule 46).
      lines: (invoice.lineItems ?? []).map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac ?? null,
        qty: l.qty ?? 1,
        ratePaise: l.ratePaise,
        amountPaise: l.amountPaise - (l.discountPaise ?? 0),
        taxRatePct: l.taxRatePct ?? 0,
      })),
      amounts: invoice.amountsPaise,
      discount:
        invoice.discount && invoice.discount.amountPaise > 0
          ? {
              label: invoice.discount.percent ? `Discount (${invoice.discount.percent}%)` : 'Discount',
              paise: invoice.discount.amountPaise,
              subTotalPaise: (invoice.lineItems ?? []).reduce((s, l) => s + l.amountPaise, 0),
            }
          : null,
      adjustmentLabel: invoice.adjustment?.label ?? null,
      extraRows: [
        ...(invoice.referenceNumber ? [['Order no.', invoice.referenceNumber] as [string, string]] : []),
        ...(invoice.paymentTermsDays != null ? [['Terms', invoice.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${invoice.paymentTermsDays}`] as [string, string]] : []),
      ],
      subject: invoice.subject ?? null,
      salesperson: invoice.salespersonName ?? null,
      notes: invoice.notes ?? null,
      terms: invoice.termsAndConditions ?? null,
      footer: settings?.invoiceNotes ?? null,
      draft: invoice.status === InvoiceStatus.DRAFT,
      einvoice: await this.einvoiceFor(orgId, invoice._id),
    };
    return { invoice, customer, data };
  }
}
