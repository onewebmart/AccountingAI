import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { SalesInvoicesService } from './sales-invoices.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { ItemsService } from '../items/items.service';
import { DOC_NUMBER, DiscountInput, DocLineInput, isInterState, lineAmount, lineProblem, priceDoc, text } from '../orders/doc-lines';
import { addDays } from '../automation/schedule';

export interface InvoiceLineInput extends DocLineInput {
  projectId?: string | null;
}

export interface InvoiceFromLinesInput {
  customerId: string;
  invoiceNumber?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
  /** The customer's order number. */
  referenceNumber?: string | null;
  subject?: string | null;
  salespersonName?: string | null;
  termsAndConditions?: string | null;
  /** Days to pay: with no due date given, the invoice is due this many days after its date. */
  paymentTermsDays?: number | null;
  /** The project the whole invoice is for: lines without one of their own take it. */
  projectId?: string | null;
  /** Before tax: a percent of the lines, or an amount, spread over them. */
  discount?: DiscountInput | null;
  /** After tax, not taxed, at most ₹99.99 either way. */
  adjustment?: { label?: string | null; paise?: number | null } | null;
}

/** Where a sale is supplied from and to, which decides IGST or CGST and SGST. */
export interface PlaceOfSupply {
  ourStateCode: string | null;
  customerStateCode: string | null;
  interState: boolean;
}

/**
 * An invoice typed line by line. The browser sends what was sold, how many,
 * the rate and the slab, and any discount or adjustment; the discount is
 * spread over the lines, the tax worked out on what is left, for the
 * customer's state, the same way as for quotes and orders. It is a draft:
 * nothing reaches the ledger until a person posts it.
 */
@Injectable()
export class InvoiceFromLinesService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    private items: ItemsService,
    private invoices: SalesInvoicesService,
  ) {}

  /** Our state (from the GSTIN, else settings) against the customer's. */
  async placeOfSupply(orgId: string, customerId: string): Promise<PlaceOfSupply> {
    const customer = await this.customer(orgId, customerId);
    return this.supplyFor(orgId, customer);
  }

  async create(orgId: string, actorId: string, input: InvoiceFromLinesInput): Promise<SalesInvoiceDocument> {
    if (!input.lines?.length) throw new BadRequestException('Add at least one line.');
    input.lines.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const terms = input.paymentTermsDays ?? null;
    if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) throw new BadRequestException('Payment terms are 0 to 365 days.');
    const dueDate = input.dueDate || (terms !== null ? addDays(input.invoiceDate, terms) : null);
    if (dueDate && dueDate < input.invoiceDate) {
      throw new BadRequestException('The due date cannot be before the invoice date.');
    }
    const invoiceNumber = input.invoiceNumber?.trim() || null;
    if (invoiceNumber) {
      if (!DOC_NUMBER.test(invoiceNumber)) throw new BadRequestException('An invoice number is up to 16 letters, digits, "/" and "-" (rule 46).');
      if (await this.invoices.numberTaken(orgId, invoiceNumber, input.invoiceDate)) {
        throw new BadRequestException(`Invoice number ${invoiceNumber} is already used this financial year. Leave it blank to take the next one.`);
      }
    }
    const customer = await this.customer(orgId, input.customerId);
    const { interState } = await this.supplyFor(orgId, customer);

    // Items fill the HSN/SAC and unit a line leaves out, and the project is checked to be this org's.
    const resolved = await this.items.resolveLines(
      orgId,
      input.lines.map((l) => ({
        description: l.description.trim(),
        itemId: l.itemId || null,
        hsnSac: l.hsnSac?.trim() || null,
        uqc: l.uqc || null,
        qty: l.qty,
        ratePaise: l.ratePaise,
        amountPaise: lineAmount(l),
        taxRatePct: l.taxRatePct,
        projectId: l.projectId || input.projectId || null,
      })),
      'sale',
    );
    const priced = priceDoc(
      resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })),
      interState,
      { discount: input.discount, adjustment: input.adjustment },
    );

    return this.invoices.create({
      orgId,
      actorId,
      customerId: String(customer._id),
      invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate,
      amountsPaise: priced.amounts,
      lineItems: priced.lines,
      notes: text(input.notes, 2000),
      referenceNumber: text(input.referenceNumber, 60),
      subject: text(input.subject, 250),
      salespersonName: text(input.salespersonName, 80),
      termsAndConditions: text(input.termsAndConditions, 3000),
      paymentTermsDays: terms,
      discount: priced.discount,
      adjustment: priced.adjustment,
    });
  }

  private async supplyFor(orgId: string, customer: CustomerDocument): Promise<PlaceOfSupply> {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const ours = settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null;
    const theirs = customer.gstin?.slice(0, 2) ?? customer.stateCode ?? null;
    return { ourStateCode: ours, customerStateCode: theirs, interState: isInterState(ours, theirs) };
  }

  private async customer(orgId: string, id: string): Promise<CustomerDocument> {
    const c = Types.ObjectId.isValid(id) ? await this.customerModel.findOne({ _id: id, orgId }).exec() : null;
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }
}
