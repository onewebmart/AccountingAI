import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { withOrg } from '../database/tenant.plugin';
import { buildAgeingSummary, AgeingSummary } from '../purchase/ageing.util';

export interface CreateCustomerInput {
  orgId: string;
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  openingBalancePaise?: number;
  notes?: string | null;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
  ) {}

  async create(input: CreateCustomerInput): Promise<CustomerDocument> {
    return this.customerModel.create({
      orgId: input.orgId,
      name: input.name,
      gstin: input.gstin ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      openingBalancePaise: input.openingBalancePaise ?? 0,
      notes: input.notes ?? null,
    });
  }

  async list(orgId: string): Promise<CustomerDocument[]> {
    return withOrg(orgId, () => this.customerModel.find().sort({ name: 1 }).exec());
  }

  async findById(id: string, orgId: string): Promise<CustomerDocument> {
    const customer = await withOrg(orgId, () => this.customerModel.findById(id).exec());
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Sum of all posted-but-unpaid invoice amounts for this customer. */
  async receivable(customerId: string, orgId: string): Promise<number> {
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel
        .find({
          customerId: new Types.ObjectId(customerId),
          status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] },
        })
        .exec(),
    );
    return invoices.reduce((sum, inv) => sum + inv.amountsPaise.total, 0);
  }

  /** AR ageing: bucket posted/sent-but-unpaid invoices by days past due date. */
  async arAgeing(orgId: string): Promise<AgeingSummary> {
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel
        .find({ status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] } })
        .exec(),
    );
    return buildAgeingSummary(
      invoices.map((inv) => ({ amountsPaise: inv.amountsPaise, dueDate: inv.dueDate })),
    );
  }
}
