import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { ItemsService } from '../items/items.service';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { AiSuggestion, AiSuggestionDocument } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { MailerService } from '../mail/mailer.service';
import { InvoicePdfData, renderInvoicePdf } from '../sales/invoice-pdf';
import { todayIst, addDays } from '../automation/schedule';
import { ChallanReason, DeliveryChallan, DeliveryChallanDocument, DocLine, Quote, QuoteDocument, SalesOrder, SalesOrderDocument } from './schemas/sales-docs.schema';
import { DOC_NUMBER, DiscountInput, DocLineInput, adjustmentOf, discountAsked, docAmounts, isInterState, lineAmount, lineProblem, priceDoc, text } from './doc-lines';
import { matchItem, parseOrderMessage, unitCode } from './quote-parser';
import { QUOTE_MODEL, QuoteModel, readQuoteAnswer } from './quote-model';
import { aiFailureReason } from '../common/ai-failure';

export const QUOTE_DRAFT_QUEUE = 'quote-drafts';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FOLLOW_UP_DAYS = 7;

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What every sales document may carry besides its lines. All optional. */
export interface DocExtras {
  /** Typed by a person; blank takes the next number in the series. */
  number?: string | null;
  referenceNumber?: string | null;
  subject?: string | null;
  salespersonName?: string | null;
  termsAndConditions?: string | null;
  notes?: string | null;
  discount?: DiscountInput | null;
  adjustment?: { label?: string | null; paise?: number | null } | null;
}

export const CHALLAN_WORDS: Record<ChallanReason, string> = { supply: 'Supply, invoiced later', liquid_gas: 'Supply of liquid gas', job_work: 'Job work', approval: 'On approval', other: 'Other' };

/**
 * Quotes, sales orders and delivery challans: what comes before an invoice.
 * None of them posts. Converting an accepted quote or an order makes a draft
 * invoice, which posts the usual way when a person posts it.
 */
@Injectable()
export class SalesDocsService {
  constructor(
    @InjectModel(Quote.name) private quoteModel: Model<QuoteDocument>,
    @InjectModel(SalesOrder.name) private orderModel: Model<SalesOrderDocument>,
    @InjectModel(DeliveryChallan.name) private challanModel: Model<DeliveryChallanDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(AiSuggestion.name) private suggestionModel: Model<AiSuggestionDocument>,
    @InjectQueue(QUOTE_DRAFT_QUEUE) private queue: Queue,
    @Inject(QUOTE_MODEL) private model: QuoteModel,
    private usageMeter: UsageMeterService,
    private invoices: SalesInvoicesService,
    private items: ItemsService,
    private posting: PostingService,
    private mailer: MailerService,
    private audit: AuditService,
  ) {}

  // ── Quotes ────────────────────────────────────────────────────────────────

  async listQuotes(orgId: string, today = todayIst(), id?: string): Promise<Array<Record<string, unknown>>> {
    const quotes = await this.quoteModel.find(oneOrAll(orgId, id)).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const names = await this.customerNames(orgId, quotes.map((q) => q.customerId));
    return quotes.map((q) => ({ ...q, customerName: names.get(String(q.customerId)) ?? 'Unknown', expired: q.status === 'sent' && q.validUntil < today }));
  }

  async createQuote(orgId: string, actorId: string, input: DocExtras & { customerId: string; date?: string; validUntil?: string; projectId?: string | null; lines: DocLineInput[] }, drafted: Quote['drafted'] = null) {
    const customer = await this.customer(orgId, input.customerId);
    const date = input.date ?? todayIst();
    const validUntil = input.validUntil ?? addDays(date, 15);
    if (!DATE.test(date) || !DATE.test(validUntil) || validUntil < date) throw new BadRequestException('A quote is valid from its date to a date on or after it.');
    const { lines, amounts, discount, adjustment } = await this.priced(orgId, customer, input.lines, input);
    const number = await this.number(orgId, 'QUOTE', 'QT', date, input.number);
    const quote = await this.quoteModel.create({
      orgId, customerId: customer._id, number, date, validUntil, status: 'draft', lines, amountsPaise: amounts, discount, adjustment,
      projectId: await this.projectId(orgId, input.projectId), ...this.extras(input), drafted, createdBy: actorId,
    });
    await this.audit.record({ orgId, entityType: 'Quote', entityId: quote._id.toString(), action: 'CREATE', performedBy: actorId, after: { number, totalPaise: amounts.total, discountPaise: discount?.amountPaise ?? 0, adjustmentPaise: adjustment?.paise ?? 0, drafted: drafted?.source ?? null } });
    return quote;
  }

  async updateQuote(orgId: string, actorId: string, id: string, input: Omit<DocExtras, 'number'> & { validUntil?: string; lines?: DocLineInput[] }) {
    const quote = await this.quote(orgId, id);
    if (quote.status !== 'draft') throw new BadRequestException('Only a draft quote can be changed; a sent one is what the customer has.');
    const customer = await this.customer(orgId, String(quote.customerId));
    const before = { totalPaise: quote.amountsPaise.total, validUntil: quote.validUntil };
    if (input.lines || input.discount !== undefined || input.adjustment !== undefined) {
      const { lines, amounts, discount, adjustment } = await this.priced(orgId, customer, input.lines ?? quote.lines.map((l) => this.plain(l)), {
        discount: input.discount !== undefined ? input.discount : discountAsked(quote.discount),
        adjustment: input.adjustment !== undefined ? input.adjustment : quote.adjustment,
      });
      quote.lines = lines as DocLine[];
      quote.amountsPaise = amounts;
      quote.discount = discount;
      quote.adjustment = adjustment;
    }
    if (input.validUntil) {
      if (!DATE.test(input.validUntil) || input.validUntil < quote.date) throw new BadRequestException('Valid until is on or after the quote date.');
      quote.validUntil = input.validUntil;
    }
    for (const [k, v] of Object.entries(this.extras(input, true))) quote.set(k, v);
    await quote.save();
    await this.audit.record({ orgId, entityType: 'Quote', entityId: id, action: 'UPDATE', performedBy: actorId, before, after: { totalPaise: quote.amountsPaise.total, validUntil: quote.validUntil } });
    return quote;
  }

  /** Marks it sent, and emails the PDF when there is somewhere to send it. */
  async sendQuote(orgId: string, actorId: string, id: string, input: { to?: string | null } = {}) {
    const quote = await this.quote(orgId, id);
    if (!['draft', 'sent'].includes(quote.status)) throw new BadRequestException(`This quote is ${quote.status}.`);
    const customer = await this.customer(orgId, String(quote.customerId));
    const to = (input.to ?? customer.email ?? '').trim() || null;
    let emailed = false;
    if (to && this.mailer.configured) {
      const data = await this.pdfData(orgId, 'quote', quote);
      await this.mailer.send({
        to, fromName: data.seller.name, replyTo: data.seller.email, subject: `Quotation ${quote.number} from ${data.seller.name}`,
        text: [`Dear ${customer.name},`, '', `Please find our quotation ${quote.number} for ${rupees(quote.amountsPaise.total)}, valid until ${quote.validUntil}.`, '', 'Thank you.', data.seller.name].join('\n'),
        attachments: [{ filename: `Quotation-${quote.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content: renderInvoicePdf(data), contentType: 'application/pdf' }],
      });
      emailed = true;
    }
    const before = quote.status;
    quote.set({ status: 'sent', sentAt: new Date(), sentTo: emailed ? to : quote.sentTo });
    await quote.save();
    await this.audit.record({ orgId, entityType: 'Quote', entityId: id, action: 'SEND', performedBy: actorId, before: { status: before }, after: { status: 'sent', emailedTo: emailed ? to : null } });
    return { quote, emailed };
  }

  async answerQuote(orgId: string, actorId: string, id: string, answer: 'accepted' | 'declined') {
    const quote = await this.quote(orgId, id);
    if (!['draft', 'sent'].includes(quote.status)) throw new BadRequestException(`This quote is ${quote.status}.`);
    const before = quote.status;
    quote.status = answer;
    await quote.save();
    await this.audit.record({ orgId, entityType: 'Quote', entityId: id, action: answer === 'accepted' ? 'ACCEPT' : 'DECLINE', performedBy: actorId, before: { status: before }, after: { status: answer } });
    return quote;
  }

  /** An accepted quote becomes a sales order, or straight away a draft invoice. */
  async convertQuote(orgId: string, actorId: string, id: string, to: 'sales_order' | 'invoice') {
    const quote = await this.quote(orgId, id);
    if (!['accepted', 'sent', 'draft'].includes(quote.status)) throw new BadRequestException(`This quote is ${quote.status}.`);
    // Claim it, so two clicks make one document.
    const claimed = await this.quoteModel.findOneAndUpdate({ _id: quote._id, orgId, status: quote.status }, { $set: { status: 'converted' } }, { new: true }).exec();
    if (!claimed) throw new BadRequestException('This quote has just been converted.');
    let made: { kind: 'sales_order' | 'invoice'; id: string };
    // The discounted lines and the adjustment go across as they are: the order or invoice charges what was quoted.
    const carried = { termsAndConditions: quote.termsAndConditions ?? null, subject: quote.subject ?? null, salespersonName: quote.salespersonName ?? null };
    if (to === 'sales_order') {
      const order = await this.orderModel.create({
        orgId, customerId: quote.customerId, number: await this.number(orgId, 'SALES_ORDER', 'SO', todayIst()), date: todayIst(), quoteId: quote._id,
        status: 'open', lines: quote.lines, amountsPaise: quote.amountsPaise, discount: quote.discount ?? null, adjustment: quote.adjustment ?? null,
        customerPoNumber: quote.referenceNumber ?? null, notes: quote.notes, ...carried, createdBy: actorId,
      });
      made = { kind: 'sales_order', id: order._id.toString() };
    } else {
      const invoice = await this.draftInvoice(orgId, actorId, String(quote.customerId), quote.lines, { kind: 'quote', id: quote._id.toString() }, {
        ...carried, notes: [`From quotation ${quote.number}`, quote.notes].filter(Boolean).join('\n'), referenceNumber: quote.referenceNumber ?? null,
        discount: quote.discount ?? null, adjustment: quote.adjustment ?? null, projectId: quote.projectId ? String(quote.projectId) : null,
      });
      made = { kind: 'invoice', id: invoice._id.toString() };
    }
    claimed.convertedTo = made;
    await claimed.save();
    await this.audit.record({ orgId, entityType: 'Quote', entityId: id, action: 'CONVERT', performedBy: actorId, before: { status: quote.status }, after: { status: 'converted', ...made } });
    return made;
  }

  /** Sent quotes with no answer after a week, each with a follow-up to send. */
  async followUps(orgId: string, today = todayIst()) {
    const due = new Date(Date.parse(`${today}T00:00:00Z`) - FOLLOW_UP_DAYS * 86_400_000);
    const quotes = await this.quoteModel.find({ orgId, status: 'sent', sentAt: { $lte: due } }).sort({ sentAt: 1 }).lean().exec();
    const names = await this.customerNames(orgId, quotes.map((q) => q.customerId));
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const us = settings?.displayName?.trim() || 'us';
    return quotes.map((q) => {
      const name = names.get(String(q.customerId)) ?? 'there';
      const expired = q.validUntil < today;
      return {
        quoteId: String(q._id),
        number: q.number,
        customerName: name,
        sentOn: q.sentAt ? new Date(q.sentAt).toISOString().slice(0, 10) : null,
        totalPaise: q.amountsPaise.total,
        message: [
          `Dear ${name},`,
          '',
          `Following up on our quotation ${q.number} of ${q.date} for ${rupees(q.amountsPaise.total)}. ${expired ? `It was valid until ${q.validUntil}; we are happy to renew it.` : `It is valid until ${q.validUntil}.`}`,
          'Please let us know if you would like to go ahead, or if anything needs changing.',
          '',
          `Regards,\n${us}`,
        ].join('\n'),
      };
    });
  }

  /** What this customer last paid for an item, else its list price. */
  async lastPrice(orgId: string, customerId: string, itemId: string | null, description: string | null) {
    const match = itemId ? { 'lineItems.itemId': new Types.ObjectId(itemId) } : description ? { 'lineItems.description': new RegExp(`^${description.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : null;
    if (match && Types.ObjectId.isValid(customerId)) {
      const [last] = await this.invoiceModel
        .aggregate<{ ratePaise: number; date: string; number: string | null }>([
          { $match: { orgId, customerId: new Types.ObjectId(customerId) } },
          { $unwind: '$lineItems' },
          { $match: match },
          { $sort: { invoiceDate: -1 } },
          { $limit: 1 },
          { $project: { ratePaise: '$lineItems.ratePaise', date: '$invoiceDate', number: '$invoiceNumber' } },
        ])
        .exec();
      if (last) return { ratePaise: last.ratePaise, source: 'last_invoice' as const, reason: `Charged to this customer on invoice ${last.number ?? ''} of ${last.date}` };
    }
    if (itemId && Types.ObjectId.isValid(itemId)) {
      const item = await this.itemModel.findOne({ _id: itemId, orgId }).lean().exec();
      if (item?.salePricePaise != null) return { ratePaise: item.salePricePaise, source: 'item' as const, reason: `${item.name}'s sale price` };
    }
    return null;
  }

  /**
   * A draft quote from a customer's message. The rules read quantities and
   * match the org's own items; prices come from this customer's history.
   * When the rules read nothing, the model tries in a background job. A
   * person checks and sends it either way.
   */
  async draftFromMessage(orgId: string, actorId: string, input: { customerId: string; text: string }) {
    const customer = await this.customer(orgId, input.customerId);
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('Paste the customer’s message.');
    const items = await this.itemModel.find({ orgId, isActive: true }).lean().exec();
    const { lines: parsed, skipped } = parseOrderMessage(text);
    if (parsed.length === 0) {
      if (!this.model.available || items.length === 0) {
        throw new BadRequestException('No quantities could be read from that message. Type the quote, or set up items and AI to draft it.');
      }
      const s = await this.suggestionModel.create({ orgId, kind: 'quote_draft', status: 'queued', input: { customerId: String(customer._id), text }, requestedBy: actorId });
      await this.queue.add('draft', { orgId, suggestionId: s._id.toString() }, { attempts: 2, removeOnComplete: true, removeOnFail: 100 });
      return { status: 'queued' as const, suggestionId: s._id.toString(), quote: null };
    }
    const unread: string[] = [...skipped];
    const lines: DocLineInput[] = [];
    for (const p of parsed) {
      const hit = matchItem(p.itemText, items);
      if (!hit) unread.push(p.text);
      lines.push(await this.lineFor(orgId, String(customer._id), hit?.item ?? null, p.itemText, p.qty, unitCode(p.unit)));
    }
    const quote = await this.createQuote(orgId, actorId, { customerId: String(customer._id), lines }, { source: 'rules', message: text.slice(0, 2000), unread });
    return { status: 'done' as const, suggestionId: null, quote };
  }

  /** The job: the model reads the message against the org's item names. */
  async runQuoteModel(orgId: string, suggestionId: string) {
    const s = await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'quote_draft' }).exec();
    if (!s || s.status !== 'queued') return;
    const { customerId, text } = s.input as { customerId: string; text: string };
    const items = await this.itemModel.find({ orgId, isActive: true }).lean().exec();
    let answer: Awaited<ReturnType<QuoteModel['read']>>;
    try {
      answer = await this.model.read(text, items.map((i) => i.name));
    } catch (err) {
      // A model error ends the wait with a reason; the quote can be typed by hand.
      s.set({ status: 'failed', reason: `${aiFailureReason(err)} Or type the quote.` });
      await s.save();
      return;
    }
    if (answer) await this.usageMeter.recordAiTokens(orgId, answer.tokensIn, answer.tokensOut);
    const read = answer ? readQuoteAnswer(answer.raw, items.map((i) => i.name)) : [];
    if (read.length === 0) {
      s.set({ status: 'none', reason: 'The AI found none of your items in the message.' });
      await s.save();
      return;
    }
    const lines: DocLineInput[] = [];
    for (const r of read) {
      const item = items.find((i) => i.name === r.item)!;
      lines.push(await this.lineFor(orgId, customerId, item, item.name, r.qty, null));
    }
    const quote = await this.createQuote(orgId, String(s.requestedBy), { customerId, lines }, { source: 'model', message: text.slice(0, 2000), unread: [] });
    s.set({ status: 'done', source: 'model', result: { quoteId: quote._id.toString() }, confidence: 0.7, reason: 'Read by AI: check every line.' });
    await s.save();
  }

  async quoteDraftStatus(orgId: string, suggestionId: string) {
    const s = Types.ObjectId.isValid(suggestionId) ? await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'quote_draft' }).lean().exec() : null;
    if (!s) throw new NotFoundException('Not found');
    return { status: s.status, quoteId: (s.result as { quoteId?: string } | null)?.quoteId ?? null, message: s.reason };
  }

  // ── Sales orders ──────────────────────────────────────────────────────────

  async createOrder(orgId: string, actorId: string, input: Omit<DocExtras, 'referenceNumber'> & { customerId: string; date?: string; expectedBy?: string | null; customerPoNumber?: string | null; deliveryMethod?: string | null; paymentTermsDays?: number | null; lines: DocLineInput[] }) {
    const customer = await this.customer(orgId, input.customerId);
    const date = input.date ?? todayIst();
    if (!DATE.test(date)) throw new BadRequestException('date must look like 2026-11-04');
    if (input.expectedBy && (!DATE.test(input.expectedBy) || input.expectedBy < date)) throw new BadRequestException('The expected shipment date is on or after the order date.');
    const terms = input.paymentTermsDays ?? null;
    if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) throw new BadRequestException('Payment terms are 0 to 365 days.');
    const { lines, amounts, discount, adjustment } = await this.priced(orgId, customer, input.lines, input);
    const order = await this.orderModel.create({
      orgId, customerId: customer._id, number: await this.number(orgId, 'SALES_ORDER', 'SO', date, input.number), date, expectedBy: input.expectedBy || null,
      customerPoNumber: input.customerPoNumber?.trim() || null, status: 'open', lines, amountsPaise: amounts, discount, adjustment,
      deliveryMethod: text(input.deliveryMethod, 60), paymentTermsDays: terms, ...this.extras(input), createdBy: actorId,
    });
    await this.audit.record({ orgId, entityType: 'SalesOrder', entityId: order._id.toString(), action: 'CREATE', performedBy: actorId, after: { number: order.number, totalPaise: amounts.total, discountPaise: discount?.amountPaise ?? 0, adjustmentPaise: adjustment?.paise ?? 0 } });
    return order;
  }

  /** Orders with each line's ordered, invoiced and delivered quantities. */
  async listOrders(orgId: string, id?: string): Promise<Array<Record<string, unknown>>> {
    const orders = await this.orderModel.find(oneOrAll(orgId, id)).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const names = await this.customerNames(orgId, orders.map((o) => o.customerId));
    const progress = await this.progress(orgId, orders.map((o) => String(o._id)));
    return orders.map((o) => {
      const p = progress.get(String(o._id)) ?? { invoiced: new Map(), delivered: new Map() };
      const lines = o.lines.map((l, i) => ({ ...l, invoicedQty: p.invoiced.get(i) ?? 0, deliveredQty: p.delivered.get(i) ?? 0 }));
      return { ...o, customerName: names.get(String(o.customerId)) ?? 'Unknown', lines, fullyInvoiced: lines.every((l) => l.invoicedQty >= l.qty) };
    });
  }

  /** Bill part or all of an order: the chosen quantities of its lines, as a draft invoice. */
  async invoiceOrder(orgId: string, actorId: string, id: string, pick: Array<{ orderLine: number; qty: number }>) {
    const order = await this.order(orgId, id);
    if (order.status !== 'open') throw new BadRequestException(`This order is ${order.status}.`);
    const done = (await this.progress(orgId, [id])).get(id)?.invoiced ?? new Map<number, number>();
    const chosen = pick.filter((p) => p.qty > 0);
    if (chosen.length === 0) throw new BadRequestException('Choose what to invoice.');
    // Discount already billed on each order line, so the last part of a line takes exactly what is left of its discount.
    const billedDiscount = await this.discountInvoiced(orgId, id);
    const lines = chosen.map((p) => {
      const line = order.lines[p.orderLine];
      if (!line) throw new BadRequestException(`No line ${p.orderLine + 1} on this order.`);
      const left = Math.round((line.qty - (done.get(p.orderLine) ?? 0)) * 1000) / 1000;
      if (p.qty > left) throw new BadRequestException(`Line ${p.orderLine + 1}: only ${left} left to invoice.`);
      const lineDiscount = line.discountPaise ?? 0;
      const share = p.qty === left ? lineDiscount - (billedDiscount.get(p.orderLine) ?? 0) : Math.round((lineDiscount * p.qty) / line.qty);
      return { ...this.plain(line), qty: p.qty, discountPaise: Math.max(0, Math.min(share, Math.round(p.qty * line.ratePaise))) };
    });
    // The order's rounding goes on an invoice that bills all of it at once; a part invoice rounds on its own.
    const whole = done.size === 0 && order.lines.every((l, i) => chosen.some((p) => p.orderLine === i && p.qty === l.qty));
    const billed = lines.reduce((s, l) => s + l.discountPaise, 0);
    const invoice = await this.draftInvoice(orgId, actorId, String(order.customerId), lines as unknown as DocLine[], { kind: 'sales_order', id, lines: chosen.map((p) => ({ orderLine: p.orderLine, qty: p.qty })) }, {
      notes: [`Against sales order ${order.number}${order.customerPoNumber ? ` (your PO ${order.customerPoNumber})` : ''}`, order.notes].filter(Boolean).join('\n'),
      referenceNumber: order.customerPoNumber ?? order.number, subject: order.subject ?? null, salespersonName: order.salespersonName ?? null, termsAndConditions: order.termsAndConditions ?? null,
      paymentTermsDays: order.paymentTermsDays ?? null, discount: billed > 0 ? { percent: order.discount?.percent ?? null, amountPaise: billed } : null,
      adjustment: whole ? order.adjustment ?? null : null,
    });
    // Fully invoiced: the order is done.
    const after = (await this.progress(orgId, [id])).get(id)?.invoiced ?? new Map<number, number>();
    if (order.lines.every((l, i) => (after.get(i) ?? 0) >= l.qty)) await this.orderModel.updateOne({ _id: id, orgId }, { $set: { status: 'closed' } }).exec();
    await this.audit.record({ orgId, entityType: 'SalesOrder', entityId: id, action: 'INVOICE', performedBy: actorId, after: { invoiceId: String(invoice._id), lines: chosen } });
    return invoice;
  }

  async setOrderStatus(orgId: string, actorId: string, id: string, status: 'closed' | 'cancelled') {
    const order = await this.order(orgId, id);
    if (order.status !== 'open') throw new BadRequestException(`This order is ${order.status}.`);
    if (status === 'cancelled' && (await this.invoiceModel.exists({ orgId, 'source.kind': 'sales_order', 'source.id': id }).exec())) {
      throw new BadRequestException('Part of this order is invoiced: close it instead of cancelling.');
    }
    order.status = status;
    await order.save();
    await this.audit.record({ orgId, entityType: 'SalesOrder', entityId: id, action: status === 'closed' ? 'CLOSE' : 'CANCEL', performedBy: actorId, before: { status: 'open' }, after: { status } });
    return order;
  }

  // ── Delivery challans ─────────────────────────────────────────────────────

  async createChallan(orgId: string, actorId: string, input: Omit<DocExtras, 'discount' | 'adjustment'> & { customerId: string; date?: string; reason: ChallanReason; salesOrderId?: string | null; lines: Array<DocLineInput & { orderLine?: number | null }>; vehicleNo?: string | null }) {
    const customer = await this.customer(orgId, input.customerId);
    const date = input.date ?? todayIst();
    if (!DATE.test(date)) throw new BadRequestException('date must look like 2026-11-04');
    if (!(input.reason in CHALLAN_WORDS)) throw new BadRequestException('Say why the goods move: liquid gas, job work, on approval, a supply invoiced later, or other.');
    let order: SalesOrderDocument | null = null;
    if (input.salesOrderId) {
      order = await this.order(orgId, input.salesOrderId);
      if (String(order.customerId) !== String(customer._id)) throw new BadRequestException('The order is for another customer.');
      const delivered = (await this.progress(orgId, [String(order._id)])).get(String(order._id))?.delivered ?? new Map<number, number>();
      for (const l of input.lines) {
        if (l.orderLine == null) continue;
        const line = order.lines[l.orderLine];
        if (!line) throw new BadRequestException(`No line ${l.orderLine + 1} on the order.`);
        const left = line.qty - (delivered.get(l.orderLine) ?? 0);
        if (l.qty > left) throw new BadRequestException(`Order line ${l.orderLine + 1}: only ${left} left to deliver.`);
      }
    }
    const { lines } = await this.priced(orgId, customer, input.lines);
    const challan = await this.challanModel.create({
      orgId, customerId: customer._id, number: await this.number(orgId, 'CHALLAN', 'DC', date, input.number), date, reason: input.reason, salesOrderId: order?._id ?? null,
      lines: lines.map((line, i) => ({ line, orderLine: input.lines[i].orderLine ?? null })), status: 'issued', vehicleNo: input.vehicleNo?.trim().toUpperCase() || null,
      ...this.extras(input), createdBy: actorId,
    });
    await this.audit.record({ orgId, entityType: 'DeliveryChallan', entityId: challan._id.toString(), action: 'CREATE', performedBy: actorId, after: { number: challan.number, reason: input.reason, salesOrderId: input.salesOrderId ?? null } });
    return challan;
  }

  async listChallans(orgId: string, id?: string): Promise<Array<Record<string, unknown>>> {
    const challans = await this.challanModel.find(oneOrAll(orgId, id)).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const names = await this.customerNames(orgId, challans.map((c) => c.customerId));
    return challans.map((c) => ({ ...c, customerName: names.get(String(c.customerId)) ?? 'Unknown' }));
  }

  async setChallanStatus(orgId: string, actorId: string, id: string, status: 'returned' | 'cancelled') {
    const challan = Types.ObjectId.isValid(id) ? await this.challanModel.findOne({ _id: id, orgId }).exec() : null;
    if (!challan) throw new NotFoundException('Challan not found');
    if (challan.status !== 'issued') throw new BadRequestException(`This challan is ${challan.status}.`);
    challan.status = status;
    await challan.save();
    await this.audit.record({ orgId, entityType: 'DeliveryChallan', entityId: id, action: status.toUpperCase(), performedBy: actorId, before: { status: 'issued' }, after: { status } });
    return challan;
  }

  // ── One record, as its list shows it ─────────────────────────────────────

  async getQuote(orgId: string, id: string) {
    return only(await this.listQuotes(orgId, todayIst(), id), 'Quote');
  }

  async getOrder(orgId: string, id: string) {
    return only(await this.listOrders(orgId, id), 'Sales order');
  }

  async getChallan(orgId: string, id: string) {
    return only(await this.listChallans(orgId, id), 'Challan');
  }

  // ── PDFs ──────────────────────────────────────────────────────────────────

  async pdf(orgId: string, kind: 'quote' | 'sales_order' | 'challan', id: string) {
    const doc = kind === 'quote' ? await this.quote(orgId, id) : kind === 'sales_order' ? await this.order(orgId, id) : await this.challanModel.findOne({ _id: id, orgId }).exec();
    if (!doc) throw new NotFoundException('Not found');
    const data = await this.pdfData(orgId, kind, doc);
    return { filename: `${data.title?.replace(/\s+/g, '-')}-${String(data.number).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content: renderInvoicePdf(data) };
  }

  private async pdfData(orgId: string, kind: 'quote' | 'sales_order' | 'challan', doc: QuoteDocument | SalesOrderDocument | DeliveryChallanDocument): Promise<InvoicePdfData> {
    const [settings, customer] = await Promise.all([this.settingsModel.findOne({ orgId }).lean().exec(), this.customerModel.findOne({ _id: doc.customerId, orgId }).lean().exec()]);
    const gstin = settings?.gstin?.trim().toUpperCase() || null;
    const lines: DocLine[] = kind === 'challan' ? (doc as DeliveryChallanDocument).lines.map((l) => l.line) : (doc as QuoteDocument).lines;
    const interState = isInterState(gstin?.slice(0, 2) ?? settings?.stateCode, customer?.stateCode ?? customer?.gstin?.slice(0, 2));
    const row = (label: string, value: string | null | undefined): Array<[string, string]> => (value ? [[label, value]] : []);
    const q = doc as QuoteDocument;
    const o = doc as SalesOrderDocument;
    const c = doc as DeliveryChallanDocument;
    const extra: Array<[string, string]> =
      kind === 'quote' ? [['Valid until', q.validUntil], ...row('Reference', q.referenceNumber)]
      : kind === 'sales_order'
        ? [...row('Your PO', o.customerPoNumber), ...row('Expected shipment', o.expectedBy), ...row('Delivery', o.deliveryMethod), ...row('Payment terms', o.paymentTermsDays != null ? (o.paymentTermsDays === 0 ? 'Due on receipt' : `${o.paymentTermsDays} days`) : null)]
        : [['Reason', CHALLAN_WORDS[c.reason] ?? 'Other'], ...row('Reference', c.referenceNumber), ...row('Vehicle', c.vehicleNo)];
    const discount = kind === 'challan' ? null : (doc as QuoteDocument).discount ?? null;
    return {
      seller: { name: settings?.displayName?.trim() || 'Your business', address: settings?.address ?? null, gstin, pan: settings?.pan ?? null, stateCode: gstin?.slice(0, 2) ?? settings?.stateCode ?? null, phone: settings?.phone ?? null, email: settings?.email ?? null },
      buyer: { name: customer?.name ?? 'Customer', address: customer?.address ?? null, gstin: customer?.gstin ?? null, stateCode: customer?.stateCode ?? customer?.gstin?.slice(0, 2) ?? null },
      number: doc.number,
      date: doc.date,
      dueDate: null,
      // Each line at the value it is taxed on: its amount less its share of any discount.
      lines: lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise - (l.discountPaise ?? 0), taxRatePct: l.taxRatePct })),
      amounts: kind === 'challan' ? docAmounts(lines, interState) : q.amountsPaise,
      discount: discount && discount.amountPaise > 0 ? { label: discount.percent ? `Discount (${discount.percent}%)` : 'Discount', paise: discount.amountPaise, subTotalPaise: lines.reduce((s, l) => s + l.amountPaise, 0) } : null,
      adjustmentLabel: kind === 'challan' ? null : q.adjustment?.label ?? null,
      subject: doc.subject ?? null,
      salesperson: doc.salespersonName ?? null,
      notes: doc.notes ?? null,
      terms: doc.termsAndConditions ?? null,
      footer: kind === 'challan' ? 'Not a tax invoice. Goods sent under this challan are invoiced separately.' : settings?.invoiceNotes ?? null,
      draft: false,
      title: { quote: 'QUOTATION', sales_order: 'SALES ORDER', challan: 'DELIVERY CHALLAN' }[kind],
      numberLabel: { quote: 'Quote no.', sales_order: 'Order no.', challan: 'Challan no.' }[kind],
      extraRows: extra,
    };
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * Lines checked and filled from their items, the discount spread across
   * them, tax worked out on the discounted values for the customer's state,
   * and the adjustment added after tax.
   */
  private async priced(orgId: string, customer: CustomerDocument, input: DocLineInput[], opts: { discount?: DocExtras['discount']; adjustment?: DocExtras['adjustment'] } = {}) {
    if (!input?.length) throw new BadRequestException('Add at least one line.');
    input.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(orgId, input.map((l) => ({ description: l.description.trim(), itemId: l.itemId ?? null, hsnSac: l.hsnSac ?? null, uqc: l.uqc ?? null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })), 'sale');
    const plain = resolved.map((l) => ({ description: l.description, itemId: l.itemId, hsnSac: l.hsnSac ?? null, uqc: l.uqc, qty: l.qty ?? 1, ratePaise: l.ratePaise, amountPaise: l.amountPaise, taxRatePct: l.taxRatePct ?? 0 }));
    const { lines, amounts, discount, adjustment } = priceDoc(plain, await this.interState(orgId, customer), opts);
    return { lines, amounts, discount, adjustment };
  }

  private async interState(orgId: string, customer: CustomerDocument) {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const ours = settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null;
    const theirs = customer.gstin?.slice(0, 2) ?? customer.stateCode ?? null;
    return isInterState(ours, theirs);
  }

  /**
   * A draft invoice from a quote's or order's lines, each at the discounted
   * value it was quoted or ordered at: the discount is carried, not spread
   * again. Due by the order's payment terms, else in 15 days.
   */
  private async draftInvoice(
    orgId: string,
    actorId: string,
    customerId: string,
    lines: DocLine[],
    source: { kind: 'quote' | 'sales_order'; id: string; lines?: Array<{ orderLine: number; qty: number }> },
    extras: Omit<DocExtras, 'number' | 'discount' | 'adjustment'> & { paymentTermsDays?: number | null; discount: { percent: number | null; amountPaise: number } | null; adjustment: { label: string; paise: number } | null; projectId?: string | null },
  ) {
    const customer = await this.customer(orgId, customerId);
    const input = lines.map((l) => ({ ...this.plain(l), projectId: extras.projectId ?? null }));
    input.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(orgId, input.map((l) => ({ ...l, description: l.description.trim(), amountPaise: lineAmount(l) })), 'sale');
    const priced = resolved.map((l, i) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0, discountPaise: input[i].discountPaise ?? 0 }));
    const amounts = docAmounts(priced, await this.interState(orgId, customer));
    const adjustment = adjustmentOf(extras.adjustment, amounts.total);
    if (adjustment) amounts.total += adjustment.paise;
    const today = todayIst();
    return this.invoices.create({
      orgId, actorId, customerId, invoiceDate: today, dueDate: addDays(today, extras.paymentTermsDays ?? 15), amountsPaise: amounts,
      lineItems: priced, notes: extras.notes ?? null, source,
      referenceNumber: extras.referenceNumber ?? null, subject: extras.subject ?? null, salespersonName: extras.salespersonName ?? null,
      termsAndConditions: extras.termsAndConditions ?? null, paymentTermsDays: extras.paymentTermsDays ?? null,
      discount: extras.discount && extras.discount.amountPaise > 0 ? extras.discount : null, adjustment,
    });
  }

  private plain(l: DocLine): DocLineInput {
    return { description: l.description, itemId: l.itemId ? String(l.itemId) : null, hsnSac: l.hsnSac, uqc: l.uqc, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct, discountPaise: l.discountPaise ?? 0 };
  }

  /** The words a document carries besides its lines, trimmed; only the ones given when changing one. */
  private extras(input: Omit<DocExtras, 'number' | 'discount' | 'adjustment'>, onlyGiven = false) {
    const all = {
      referenceNumber: [input.referenceNumber, 60],
      subject: [input.subject, 250],
      salespersonName: [input.salespersonName, 80],
      termsAndConditions: [input.termsAndConditions, 3000],
      notes: [input.notes, 2000],
    } as const;
    const out: Record<string, string | null> = {};
    for (const [k, [v, max]] of Object.entries(all)) if (!onlyGiven || v !== undefined) out[k] = text(v, max);
    return out;
  }

  /** A project the quote is for, checked to be this org's. */
  private async projectId(orgId: string, id: string | null | undefined): Promise<Types.ObjectId | null> {
    if (!id) return null;
    const [line] = await this.items.resolveLines(orgId, [{ description: 'project', ratePaise: 0, amountPaise: 0, projectId: id }], 'sale');
    return line.projectId;
  }

  /** Discount already on invoices made from an order, per order line. */
  private async discountInvoiced(orgId: string, orderId: string): Promise<Map<number, number>> {
    const invoices = await this.invoiceModel.find({ orgId, 'source.kind': 'sales_order', 'source.id': orderId }, { source: 1, lineItems: 1 }).lean().exec();
    const out = new Map<number, number>();
    for (const inv of invoices) {
      (inv.source?.lines ?? []).forEach((l, i) => out.set(l.orderLine, (out.get(l.orderLine) ?? 0) + (inv.lineItems[i]?.discountPaise ?? 0)));
    }
    return out;
  }

  private async lineFor(orgId: string, customerId: string, item: (Item & { _id: Types.ObjectId }) | null, text: string, qty: number, uqc: string | null): Promise<DocLineInput> {
    const price = await this.lastPrice(orgId, customerId, item ? String(item._id) : null, item ? null : text);
    const rate = item?.gstRatePct ?? 18;
    return {
      description: item?.name ?? text,
      itemId: item ? String(item._id) : null,
      hsnSac: item?.hsnSac ?? null,
      uqc: item?.uqc ?? uqc,
      qty,
      ratePaise: price?.ratePaise ?? 0,
      taxRatePct: [0, 3, 5, 12, 18, 28, 40].includes(rate) ? rate : 18,
    };
  }

  /** Invoiced and delivered quantity per order line, from the invoices and challans made against each order. */
  private async progress(orgId: string, orderIds: string[]) {
    const out = new Map<string, { invoiced: Map<number, number>; delivered: Map<number, number> }>();
    for (const id of orderIds) out.set(id, { invoiced: new Map(), delivered: new Map() });
    if (orderIds.length === 0) return out;
    const [invoices, challans] = await Promise.all([
      this.invoiceModel.find({ orgId, 'source.kind': 'sales_order', 'source.id': { $in: orderIds } }, { source: 1 }).lean().exec(),
      this.challanModel.find({ orgId, salesOrderId: { $in: orderIds.map((i) => new Types.ObjectId(i)) }, status: { $ne: 'cancelled' } }, { salesOrderId: 1, lines: 1 }).lean().exec(),
    ]);
    for (const inv of invoices) {
      const m = out.get(inv.source!.id)!.invoiced;
      for (const l of inv.source!.lines ?? []) m.set(l.orderLine, (m.get(l.orderLine) ?? 0) + l.qty);
    }
    for (const c of challans) {
      const m = out.get(String(c.salesOrderId))!.delivered;
      for (const l of c.lines) if (l.orderLine != null) m.set(l.orderLine, (m.get(l.orderLine) ?? 0) + l.line.qty);
    }
    return out;
  }

  /**
   * The document's number: the one a person typed, checked unused, or the
   * next in the series for the year. The series skips a number someone typed
   * by hand, so the two never collide.
   */
  private async number(orgId: string, series: 'QUOTE' | 'SALES_ORDER' | 'CHALLAN', prefix: string, date: string, typed?: string | null) {
    const taken = async (n: string) =>
      !!(series === 'QUOTE'
        ? await this.quoteModel.exists({ orgId, number: n }).exec()
        : series === 'SALES_ORDER'
          ? await this.orderModel.exists({ orgId, number: n }).exec()
          : await this.challanModel.exists({ orgId, number: n }).exec());
    const own = typed?.trim();
    if (own) {
      if (!DOC_NUMBER.test(own)) throw new BadRequestException('A number is up to 16 letters, digits, "/" and "-".');
      if (await taken(own)) throw new BadRequestException(`${own} is already used. Leave the number blank for the next one.`);
      return own;
    }
    const fy = financialYearOf(date);
    for (let i = 0; i < 100; i++) {
      const n = `${prefix}/${fy}/${String(await this.posting.nextDocumentNumber(orgId, series, fy)).padStart(4, '0')}`;
      if (!(await taken(n))) return n;
    }
    throw new BadRequestException('Could not find a free number. Type one.');
  }

  private async customer(orgId: string, id: string): Promise<CustomerDocument> {
    const c = Types.ObjectId.isValid(id) ? await this.customerModel.findOne({ _id: id, orgId }).exec() : null;
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private async customerNames(orgId: string, ids: Types.ObjectId[]) {
    const customers = await this.customerModel.find({ orgId, _id: { $in: ids } }, { name: 1 }).lean().exec();
    return new Map(customers.map((c) => [String(c._id), c.name]));
  }

  private async quote(orgId: string, id: string): Promise<QuoteDocument> {
    const q = Types.ObjectId.isValid(id) ? await this.quoteModel.findOne({ _id: id, orgId }).exec() : null;
    if (!q) throw new NotFoundException('Quote not found');
    return q;
  }

  private async order(orgId: string, id: string): Promise<SalesOrderDocument> {
    const o = Types.ObjectId.isValid(id) ? await this.orderModel.findOne({ _id: id, orgId }).exec() : null;
    if (!o) throw new NotFoundException('Sales order not found');
    return o;
  }
}

/** The org's records, or just the one asked for; an id that cannot be one finds nothing. */
function oneOrAll(orgId: string, id?: string): Record<string, unknown> {
  if (id === undefined) return { orgId };
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
  return { orgId, _id: new Types.ObjectId(id) };
}

function only<T>(rows: T[], what: string): T {
  if (rows.length === 0) throw new NotFoundException(`${what} not found`);
  return rows[0];
}
