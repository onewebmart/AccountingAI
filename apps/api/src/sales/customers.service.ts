import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditService } from '../gl/audit.service';
import { gstinProblem } from '../extraction/invoice-checks';
import { cleanPartyDetails, PartyDetailsInput } from '../gl/party-details';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { withOrg } from '../database/tenant.plugin';
import { buildAgeingSummary, AgeingSummary } from '../purchase/ageing.util';
import { outstandingPaise } from '../gl/schemas/settlement.schema';

export interface CreateCustomerInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** GST state code; ignored when the GSTIN gives it. */
  stateCode?: string | null;
  notes?: string | null;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    private auditService: AuditService,
  ) {}

  async create(input: CreateCustomerInput): Promise<CustomerDocument> {
    // A typed GSTIN with a wrong check digit is a typo; catch it here rather
    // than on the GST return.
    const gstin = input.gstin?.trim() ? input.gstin.trim().toUpperCase() : null;
    const problem = gstin ? gstinProblem(gstin) : null;
    if (problem) throw new BadRequestException(`GSTIN ${gstin} ${problem}`);

    const customer = await this.customerModel.create({
      orgId: input.orgId,
      name: input.name,
      gstin,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      // The GSTIN names the state it was issued in, so it wins over a picked one.
      stateCode: gstin ? gstin.slice(0, 2) : input.stateCode ?? null,
      notes: input.notes ?? null,
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'Customer',
      entityId: customer._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: { name: customer.name, gstin: customer.gstin, stateCode: customer.stateCode },
    });
    return customer;
  }

  /**
   * Customers with what each still owes. The Sales page read receivablePaise
   * off this list, but it returned the raw documents — so every customer showed
   * "Cleared" and the total receivable read ₹NaN.
   */
  async list(orgId: string): Promise<Array<Record<string, unknown> & { receivablePaise: number }>> {
    const [customers, open] = await Promise.all([
      withOrg(orgId, () => this.customerModel.find().sort({ name: 1 }).lean().exec()),
      withOrg(orgId, () =>
        this.invoiceModel.find({ status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] } }).lean().exec(),
      ),
    ]);
    const owed = new Map<string, number>();
    for (const inv of open) {
      const key = String(inv.customerId);
      owed.set(key, (owed.get(key) ?? 0) + outstandingPaise(inv));
    }
    return customers.map((c) => ({ ...c, receivablePaise: owed.get(String(c._id)) ?? 0 }));
  }

  /**
   * Change a customer's details. Invoices already issued keep the name, GSTIN
   * and state they were issued with: they are stamped first, so a corrected
   * GSTIN does not rewrite GST returns for months already filed.
   */
  async update(id: string, orgId: string, actorId: string, input: PartyDetailsInput): Promise<CustomerDocument> {
    const customer = await this.findById(id, orgId);
    const set = cleanPartyDetails(input, { gstin: customer.gstin, stateCode: customer.stateCode });
    const changed = Object.keys(set).filter((k) => set[k] !== (customer as unknown as Record<string, unknown>)[k]);
    if (changed.length === 0) return customer;

    let stamped = 0;
    if (changed.some((k) => k === 'name' || k === 'gstin' || k === 'stateCode')) {
      const result = await withOrg(orgId, () =>
        this.invoiceModel
          .updateMany(
            { customerId: customer._id, status: { $ne: InvoiceStatus.DRAFT }, partyAtIssue: null },
            { $set: { partyAtIssue: { name: customer.name, gstin: customer.gstin, stateCode: customer.stateCode } } },
          )
          .exec(),
      );
      stamped = result.modifiedCount;
    }
    const updated = await withOrg(orgId, () =>
      this.customerModel.findOneAndUpdate({ _id: customer._id }, { $set: set }, { new: true }).exec(),
    );
    const before = Object.fromEntries(changed.map((k) => [k, (customer as unknown as Record<string, unknown>)[k] ?? null]));
    await this.auditService.record({
      orgId,
      entityType: 'Customer',
      entityId: id,
      action: 'UPDATE',
      performedBy: actorId,
      before,
      after: Object.fromEntries(changed.map((k) => [k, set[k]])),
      meta: stamped ? { invoicesKeptAsIssued: stamped } : undefined,
    });
    return updated!;
  }

  async findById(id: string, orgId: string): Promise<CustomerDocument> {
    const customer = await withOrg(orgId, () => this.customerModel.findById(id).exec());
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** What this customer still owes on sent and posted invoices, after part payments. */
  async receivable(customerId: string, orgId: string): Promise<number> {
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel
        .find({
          customerId: new Types.ObjectId(customerId),
          status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] },
        })
        .exec(),
    );
    return invoices.reduce((sum, inv) => sum + outstandingPaise(inv), 0);
  }

  /** AR ageing: bucket posted/sent-but-unpaid invoices by days past due date. */
  async arAgeing(orgId: string): Promise<AgeingSummary> {
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel
        .find({ status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] } })
        .exec(),
    );
    return buildAgeingSummary(
      invoices.map((inv) => ({ owedPaise: outstandingPaise(inv), dueDate: inv.dueDate })),
    );
  }
}
