import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { partyAsIssued } from '../gl/party-as-issued';
import { withOrg } from '../database/tenant.plugin';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { InvoiceDeliveryService } from '../sales/invoice-delivery.service';
import { PortalLink, PortalLinkDocument } from './schemas/portal-link.schema';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;
/** An org id, a dot, then 32 random bytes: the org scopes the lookup, the bytes are the secret. */
const TOKEN = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/;
const GONE = 'This link has expired or was withdrawn. Ask the business for a new one.';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A customer's own view of their invoices, by a link, with no login: open
 * and recent invoices, their PDFs, and a payment link where one is open.
 * Read-only, one customer's, and only issued invoices (never drafts).
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectModel(PortalLink.name) private linkModel: Model<PortalLinkDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    private delivery: InvoiceDeliveryService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  async createLink(orgId: string, actorId: string, customerId: string, days = DEFAULT_DAYS) {
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new BadRequestException(`A link lasts 1 to ${MAX_DAYS} days.`);
    if (!Types.ObjectId.isValid(customerId)) throw new NotFoundException('Customer not found');
    const customer = await this.customerModel.findOne({ _id: customerId, orgId }, { name: 1, portalEnabled: 1 }).lean().exec();
    if (!customer) throw new NotFoundException('Customer not found');
    // Turned off in the customer's details: no link until it is turned on again.
    if (customer.portalEnabled === false) {
      throw new BadRequestException(`Portal access is turned off for ${customer.name}. Turn on "Allow portal access" in their details first.`);
    }
    const token = `${orgId}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const link = await this.linkModel.create({ orgId, customerId: customer._id, tokenHash: hash(token), expiresAt, createdBy: actorId });
    await this.audit.record({
      orgId, entityType: 'PortalLink', entityId: link._id.toString(), action: 'CREATE', performedBy: actorId,
      after: { customerId, customer: customer.name, expiresAt: expiresAt.toISOString() },
    });
    const web = this.config.get<string>('urls.web') ?? 'http://localhost:3000';
    return { url: `${web}/portal/${token}`, expiresAt };
  }

  /** Withdraw every live link for a customer. */
  async revoke(orgId: string, actorId: string, customerId: string) {
    if (!Types.ObjectId.isValid(customerId)) throw new NotFoundException('Customer not found');
    const res = await this.linkModel
      .updateMany({ orgId, customerId: new Types.ObjectId(customerId), revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
    await this.audit.record({ orgId, entityType: 'Customer', entityId: customerId, action: 'REVOKE_PORTAL_LINKS', performedBy: actorId, after: { revoked: res.modifiedCount } });
    return { revoked: res.modifiedCount };
  }

  /** What the link's holder may see. */
  async view(token: string) {
    const link = await this.link(token);
    return withOrg(link.orgId, async () => {
      const [settings, customer, invoices] = await Promise.all([
        this.settingsModel.findOne({ orgId: link.orgId }).lean().exec(),
        this.customerModel.findOne({ _id: link.customerId, orgId: link.orgId }, { name: 1 }).lean().exec(),
        this.invoiceModel
          .find({ orgId: link.orgId, customerId: link.customerId, status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED, InvoiceStatus.PAID] }, isOpeningBalance: { $ne: true } })
          .sort({ invoiceDate: -1, _id: -1 })
          .limit(100)
          .lean()
          .exec(),
      ]);
      await this.linkModel.updateOne({ _id: link._id, orgId: link.orgId }, { $set: { lastViewedAt: new Date() } }).exec();
      const rows = invoices.map((inv) => ({
        id: String(inv._id),
        number: inv.invoiceNumber ?? null,
        date: inv.invoiceDate,
        dueDate: inv.dueDate ?? null,
        totalPaise: inv.amountsPaise.total,
        // A sent invoice is not in the books yet; what it asks for is still owed.
        owedPaise: inv.status === InvoiceStatus.SENT ? inv.amountsPaise.total : outstandingPaise(inv),
        status: inv.status === InvoiceStatus.PAID ? 'paid' : 'open',
        payUrl: inv.paymentLink?.status === 'created' ? inv.paymentLink.url : null,
      }));
      return {
        business: {
          name: settings?.displayName?.trim() || 'Your supplier',
          gstin: settings?.gstin ?? null,
          address: settings?.address ?? null,
          email: settings?.email ?? null,
          phone: settings?.phone ?? null,
        },
        customer: { name: partyAsIssued({}, customer, 'Customer').name },
        invoices: rows,
        owedPaise: rows.reduce((s, r) => s + (r.status === 'open' ? r.owedPaise : 0), 0),
        expiresAt: link.expiresAt,
      };
    });
  }

  /** One of the link's invoices as a PDF. */
  async pdf(token: string, invoiceId: string) {
    const link = await this.link(token);
    if (!Types.ObjectId.isValid(invoiceId)) throw new NotFoundException('Invoice not found');
    const invoice = await this.invoiceModel
      .findOne({ _id: invoiceId, orgId: link.orgId, customerId: link.customerId, status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED, InvoiceStatus.PAID] } }, { _id: 1 })
      .lean()
      .exec();
    if (!invoice) throw new NotFoundException('Invoice not found');
    return withOrg(link.orgId, () => this.delivery.pdf(link.orgId, invoiceId));
  }

  private async link(token: string): Promise<PortalLinkDocument> {
    const m = TOKEN.exec(token ?? '');
    if (!m) throw new NotFoundException(GONE);
    const link = await this.linkModel.findOne({ orgId: m[1], tokenHash: hash(token) }).exec();
    if (!link || link.revokedAt || link.expiresAt.getTime() < Date.now()) throw new NotFoundException(GONE);
    // Portal access turned off in the customer's details: their links stop working with it.
    const customer = await withOrg(link.orgId, () =>
      this.customerModel.findOne({ _id: link.customerId, orgId: link.orgId }, { portalEnabled: 1 }).lean().exec(),
    );
    if (customer?.portalEnabled === false) throw new NotFoundException(GONE);
    return link;
  }
}
