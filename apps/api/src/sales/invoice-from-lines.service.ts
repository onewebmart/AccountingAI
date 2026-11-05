import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { SalesInvoicesService } from './sales-invoices.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { ItemsService } from '../items/items.service';
import { DocLineInput, docAmounts, isInterState, lineAmount, lineProblem } from '../orders/doc-lines';

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
}

/** Where a sale is supplied from and to, which decides IGST or CGST and SGST. */
export interface PlaceOfSupply {
  ourStateCode: string | null;
  customerStateCode: string | null;
  interState: boolean;
}

/**
 * An invoice typed line by line. The browser sends what was sold, how many,
 * the rate and the slab; the amounts and the tax heads are worked out here,
 * the same way as for quotes and orders, for the customer's state. It is a
 * draft: nothing reaches the ledger until a person posts it.
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
    if (input.dueDate && input.dueDate < input.invoiceDate) {
      throw new BadRequestException('The due date cannot be before the invoice date.');
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
        projectId: l.projectId || null,
      })),
      'sale',
    );
    const amounts = docAmounts(input.lines, interState);

    return this.invoices.create({
      orgId,
      actorId,
      customerId: String(customer._id),
      invoiceNumber: input.invoiceNumber?.trim() || null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      amountsPaise: amounts,
      lineItems: resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })),
      notes: input.notes?.trim() || null,
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
