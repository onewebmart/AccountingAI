import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { withOrg } from '../database/tenant.plugin';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PartyPaymentsService } from './party-payments.service';
import { PAYMENT_LINK_PROVIDER, PaidEvent, PaymentLinkProvider } from './gateway/payment-link.provider';

/** How long a link stays payable. */
const LINK_DAYS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Getting paid online. A link asks for what an invoice still owes. When the
 * gateway reports it paid, the invoice is marked "paid online": nothing is
 * posted until a person confirms the receipt, which books it to Payment
 * Gateway Clearing. The money reaches the bank when the gateway settles,
 * less its fee, recorded as a transfer from the clearing ledger.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @Inject(PAYMENT_LINK_PROVIDER) private provider: PaymentLinkProvider,
    private payments: PartyPaymentsService,
    private audit: AuditService,
  ) {}

  get gateway() {
    return { name: this.provider.name, isMock: this.provider.isMock };
  }

  /** A link for what the invoice still owes. A fresh one replaces any unpaid link. */
  async createLink(orgId: string, actorId: string, invoiceId: string) {
    const invoice = await this.invoice(orgId, invoiceId);
    if (invoice.status !== InvoiceStatus.POSTED) throw new BadRequestException(`Only a posted invoice with money owed can be paid online (this one is ${invoice.status}).`);
    if (!invoice.invoiceNumber) throw new BadRequestException('Post the invoice first so it carries its number.');
    if (invoice.paymentLink?.status === 'paid') throw new BadRequestException('This invoice was paid online already: confirm that receipt first.');
    const owed = outstandingPaise(invoice);
    if (owed <= 0) throw new BadRequestException('Nothing is owed on this invoice.');
    const customer = await this.customerModel.findOne({ _id: invoice.customerId, orgId }, { name: 1, email: 1, phone: 1 }).lean().exec();

    const referenceId = `${invoice._id.toString()}-${Date.now().toString(36)}`;
    const { linkId, url } = await this.provider.createLink({
      amountPaise: owed,
      description: `Invoice ${invoice.invoiceNumber}`,
      referenceId,
      customer: { name: customer?.name ?? 'Customer', email: customer?.email ?? null, phone: customer?.phone ?? null },
      expireBy: Math.floor(Date.now() / 1000) + LINK_DAYS * 86_400,
    });
    const paymentLink = {
      provider: this.provider.name,
      linkId,
      url,
      referenceId,
      amountPaise: owed,
      status: 'created' as const,
      createdAt: new Date(),
      paidPaise: null,
      paidOn: null,
      gatewayPaymentId: null,
      receiptId: null,
    };
    await this.invoiceModel.updateOne({ _id: invoice._id, orgId }, { $set: { paymentLink } }).exec();
    await this.audit.record({
      orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'PAYMENT_LINK', performedBy: actorId,
      before: { paymentLink: invoice.paymentLink?.linkId ?? null }, after: { provider: this.provider.name, linkId, amountPaise: owed },
    });
    return paymentLink;
  }

  /**
   * The gateway says a link was paid. Verified by the provider; marks the
   * invoice and posts nothing. Repeated deliveries of the same event are
   * harmless.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ ok: true; matched: boolean }> {
    if (!rawBody) throw new BadRequestException('No body.');
    let event: PaidEvent | null;
    try {
      event = this.provider.parseWebhook(rawBody, signature);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Unreadable webhook.');
    }
    if (!event) return { ok: true, matched: false };
    return { ok: true, matched: await this.markPaid(event) };
  }

  /** Test gateway only: play the customer paying the link. */
  async payMock(orgId: string, invoiceId: string) {
    if (!this.provider.isMock) throw new BadRequestException('A real gateway is configured; customers pay through the link.');
    const invoice = await this.invoice(orgId, invoiceId);
    if (!invoice.paymentLink || invoice.paymentLink.status !== 'created') throw new BadRequestException('This invoice has no open payment link.');
    await this.markPaid({
      linkId: invoice.paymentLink.linkId,
      referenceId: invoice.paymentLink.referenceId,
      paidPaise: invoice.paymentLink.amountPaise,
      gatewayPaymentId: `mock_pay_${Date.now().toString(36)}`,
      paidOn: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10),
    });
    return this.invoice(orgId, invoiceId);
  }

  /**
   * A person confirms what the gateway reported: a receipt through the
   * gateway, settling the invoice. Anything paid beyond what is now owed
   * (the invoice was settled another way meanwhile) is held as an advance.
   */
  async confirm(orgId: string, actorId: string, invoiceId: string, date?: string) {
    const invoice = await this.invoice(orgId, invoiceId);
    const link = invoice.paymentLink;
    if (!link || link.status !== 'paid' || !link.paidPaise) throw new BadRequestException('There is no online payment on this invoice to confirm.');
    const paidOn = date ?? link.paidOn!;
    if (!DATE.test(paidOn)) throw new BadRequestException('date must be a date like 2026-10-14');
    const owed = invoice.status === InvoiceStatus.POSTED ? outstandingPaise(invoice) : 0;
    const applied = Math.min(owed, link.paidPaise);
    const receipt = await this.payments.record(orgId, actorId, {
      kind: 'receipt',
      partyId: String(invoice.customerId),
      date: paidOn,
      amountPaise: link.paidPaise,
      via: 'gateway',
      reference: `${link.provider} ${link.gatewayPaymentId}`,
      allocations: applied > 0 ? [{ documentId: invoiceId, amountPaise: applied }] : [],
    });
    const done = await this.invoiceModel
      .updateOne({ _id: invoice._id, orgId, 'paymentLink.status': 'paid' }, { $set: { 'paymentLink.status': 'confirmed', 'paymentLink.receiptId': receipt._id } })
      .exec();
    if (done.modifiedCount !== 1) this.logger.warn(`Invoice ${invoiceId}: online payment confirmed twice at once`);
    await this.audit.record({
      orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'CONFIRM_ONLINE_PAYMENT', performedBy: actorId,
      before: { paymentLink: 'paid' }, after: { paymentLink: 'confirmed', receiptId: receipt._id.toString(), paidPaise: link.paidPaise },
    });
    return receipt;
  }

  private async markPaid(event: PaidEvent): Promise<boolean> {
    // The link id is the gateway's, unique to one invoice. No org context is
    // needed to find it; everything after is scoped to that invoice's org.
    const invoice = await this.invoiceModel.findOne({ 'paymentLink.linkId': event.linkId }).lean().exec();
    if (!invoice) {
      this.logger.warn(`Paid event for unknown link ${event.linkId}`);
      return false;
    }
    if (invoice.paymentLink?.status !== 'created') return true; // already recorded
    await withOrg(invoice.orgId, async () => {
      await this.invoiceModel
        .updateOne(
          { _id: invoice._id, orgId: invoice.orgId, 'paymentLink.linkId': event.linkId, 'paymentLink.status': 'created' },
          { $set: { 'paymentLink.status': 'paid', 'paymentLink.paidPaise': event.paidPaise, 'paymentLink.paidOn': event.paidOn, 'paymentLink.gatewayPaymentId': event.gatewayPaymentId } },
        )
        .exec();
      await this.audit.record({
        orgId: invoice.orgId, entityType: 'SalesInvoice', entityId: String(invoice._id), action: 'PAID_ONLINE', performedBy: `system:${this.provider.name}`,
        after: { paidPaise: event.paidPaise, gatewayPaymentId: event.gatewayPaymentId, paidOn: event.paidOn },
      });
    });
    return true;
  }

  private async invoice(orgId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Invoice not found');
    const invoice = await this.invoiceModel.findOne({ _id: id, orgId }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
