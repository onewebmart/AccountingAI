import { BadRequestException, Injectable, Optional, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument } from '../../gl/schemas/ledger-account.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../../sales/schemas/sales-invoice.schema';
import { CreditNote, CreditNoteDocument } from '../../sales/schemas/credit-note.schema';
import { Customer, CustomerDocument } from '../../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillDocument } from '../../purchase/schemas/purchase-bill.schema';
import { DebitNote, DebitNoteDocument } from '../../purchase/schemas/debit-note.schema';
import { Vendor, VendorDocument } from '../../purchase/schemas/vendor.schema';
import { Item, ItemDocument } from '../../items/schemas/item.schema';
import { DeliveryChallan, DeliveryChallanDocument, Quote, QuoteDocument, SalesOrder, SalesOrderDocument } from '../../orders/schemas/sales-docs.schema';
import { PurchaseOrder, PurchaseOrderDocument } from '../../orders/schemas/purchase-docs.schema';
import { DirectExpense, DirectExpenseDocument } from '../../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimDocument } from '../../expenses/schemas/expense-claim.schema';
import { PartyPayment, PartyPaymentDocument } from '../../payments/schemas/party-payment.schema';
import { Project, ProjectDocument } from '../../projects/schemas/project.schema';
import { TimeEntry, TimeEntryDocument } from '../../projects/schemas/time-entry.schema';
import { RecurringTemplate, RecurringTemplateDocument } from '../../automation/schemas/recurring-template.schema';
import { PaymentReminder, PaymentReminderDocument } from '../../automation/schemas/payment-reminder.schema';
import { BankAccount, BankAccountDocument } from '../../banking/schemas/bank-account.schema';
import { BankStatement, BankStatementDocument } from '../../banking/schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineDocument } from '../../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositDocument } from '../../tds/schemas/tds-deposit.schema';
import { Gstr2bLine, Gstr2bLineDocument } from '../../gst/schemas/gstr2b-line.schema';
import { User, UserDocument } from '../../tenancy/schemas/user.schema';
import { OrgMembership, OrgMembershipDocument } from '../../tenancy/schemas/org-membership.schema';
import { ImportBatch, ImportBatchDocument } from '../../migration/schemas/import-batch.schema';
import { ReportsService } from '../reports.service';
import { ManagementReportsService } from '../management.service';

export interface ChartAccount {
  id: string;
  name: string;
  code: string;
  type: AccountType;
  systemKey: string | null;
  isGroup: boolean;
  parentId: string | null;
  /** The group it sits under, by name: Current Assets, Indirect Expenses. */
  group: string | null;
}

/**
 * What every report reads from: the org's documents and posted journals,
 * read-only. Models a deployment always has are required; the rest are
 * optional so a test can build only what its reports need. Services of
 * other modules (GST returns, TDS, the forecast, foreign currency) are
 * found at run time, so their figures are the very ones their own pages
 * show and no module has to import another in a circle.
 */
@Injectable()
export class ReportDataService {
  constructor(
    readonly reports: ReportsService,
    readonly management: ManagementReportsService,
    private moduleRef: ModuleRef,
    @InjectModel(Journal.name) readonly journals: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) readonly ledgerAccounts: Model<LedgerAccountDocument>,
    @InjectModel(SalesInvoice.name) readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(CreditNote.name) readonly creditNotes: Model<CreditNoteDocument>,
    @InjectModel(Customer.name) readonly customers: Model<CustomerDocument>,
    @InjectModel(PurchaseBill.name) readonly bills: Model<PurchaseBillDocument>,
    @InjectModel(DebitNote.name) readonly debitNotes: Model<DebitNoteDocument>,
    @InjectModel(Vendor.name) readonly vendors: Model<VendorDocument>,
    @InjectModel(Item.name) readonly items: Model<ItemDocument>,
    @Optional() @InjectModel(Quote.name) private quoteModel?: Model<QuoteDocument>,
    @Optional() @InjectModel(SalesOrder.name) private salesOrderModel?: Model<SalesOrderDocument>,
    @Optional() @InjectModel(DeliveryChallan.name) private challanModel?: Model<DeliveryChallanDocument>,
    @Optional() @InjectModel(PurchaseOrder.name) private poModel?: Model<PurchaseOrderDocument>,
    @Optional() @InjectModel(DirectExpense.name) private expenseModel?: Model<DirectExpenseDocument>,
    @Optional() @InjectModel(ExpenseClaim.name) private claimModel?: Model<ExpenseClaimDocument>,
    @Optional() @InjectModel(PartyPayment.name) private paymentModel?: Model<PartyPaymentDocument>,
    @Optional() @InjectModel(Project.name) private projectModel?: Model<ProjectDocument>,
    @Optional() @InjectModel(TimeEntry.name) private timeModel?: Model<TimeEntryDocument>,
    @Optional() @InjectModel(RecurringTemplate.name) private templateModel?: Model<RecurringTemplateDocument>,
    @Optional() @InjectModel(PaymentReminder.name) private reminderModel?: Model<PaymentReminderDocument>,
    @Optional() @InjectModel(BankAccount.name) private bankAccountModel?: Model<BankAccountDocument>,
    @Optional() @InjectModel(BankStatement.name) private statementModel?: Model<BankStatementDocument>,
    @Optional() @InjectModel(BankStatementLine.name) private statementLineModel?: Model<BankStatementLineDocument>,
    @Optional() @InjectModel(TdsDeposit.name) private tdsDepositModel?: Model<TdsDepositDocument>,
    @Optional() @InjectModel(Gstr2bLine.name) private gstr2bModel?: Model<Gstr2bLineDocument>,
    @Optional() @InjectModel(AuditLog.name) private auditModel?: Model<AuditLogDocument>,
    @Optional() @InjectModel(User.name) private userModel?: Model<UserDocument>,
    @Optional() @InjectModel(OrgMembership.name) private membershipModel?: Model<OrgMembershipDocument>,
    @Optional() @InjectModel(ImportBatch.name) private batchModel?: Model<ImportBatchDocument>,
  ) {}

  private need<T>(m: T | undefined, what: string): T {
    if (!m) throw new BadRequestException(`${what} are not available in this deployment.`);
    return m;
  }

  get quotes() { return this.need(this.quoteModel, 'Quotes'); }
  get salesOrders() { return this.need(this.salesOrderModel, 'Sales orders'); }
  get challans() { return this.need(this.challanModel, 'Delivery challans'); }
  get purchaseOrders() { return this.need(this.poModel, 'Purchase orders'); }
  get expenses() { return this.need(this.expenseModel, 'Expenses'); }
  get claims() { return this.need(this.claimModel, 'Expense claims'); }
  get payments() { return this.need(this.paymentModel, 'Payments'); }
  get projects() { return this.need(this.projectModel, 'Projects'); }
  get time() { return this.need(this.timeModel, 'Time entries'); }
  get templates() { return this.need(this.templateModel, 'Recurring profiles'); }
  get reminders() { return this.need(this.reminderModel, 'Payment reminders'); }
  get bankAccounts() { return this.need(this.bankAccountModel, 'Bank accounts'); }
  get statements() { return this.need(this.statementModel, 'Bank statements'); }
  get statementLines() { return this.need(this.statementLineModel, 'Bank statement lines'); }
  get tdsDeposits() { return this.need(this.tdsDepositModel, 'TDS deposits'); }
  get gstr2b() { return this.need(this.gstr2bModel, 'GSTR-2B lines'); }
  get audit() { return this.need(this.auditModel, 'Audit logs'); }
  get users() { return this.need(this.userModel, 'Users'); }
  get memberships() { return this.need(this.membershipModel, 'Members'); }
  has(model: 'projects' | 'expenses' | 'payments' | 'claims'): boolean {
    return !!{ projects: this.projectModel, expenses: this.expenseModel, payments: this.paymentModel, claims: this.claimModel }[model];
  }

  /**
   * A service of another module, resolved when a report first needs it.
   * The import is lazy too, so loading the reports never loads (or cycles
   * through) the GST, TDS, insights or currency modules.
   */
  async service<T>(load: () => Promise<Type<T>>, what: string): Promise<T> {
    try {
      return this.moduleRef.get(await load(), { strict: false });
    } catch {
      throw new BadRequestException(`${what} is not available in this deployment.`);
    }
  }

  /** The chart of accounts, with each account's group by name. */
  async chart(orgId: string): Promise<Map<string, ChartAccount>> {
    const all = await this.ledgerAccounts.find({ orgId }, { name: 1, code: 1, type: 1, parentId: 1, isGroup: 1, systemKey: 1 }).lean().exec();
    const names = new Map(all.map((a) => [String(a._id), a.name]));
    return new Map(
      all.map((a) => [
        String(a._id),
        {
          id: String(a._id), name: a.name, code: a.code, type: a.type as AccountType, systemKey: (a.systemKey as string | undefined) ?? null,
          isGroup: !!a.isGroup, parentId: a.parentId ? String(a.parentId) : null, group: a.parentId ? names.get(String(a.parentId)) ?? null : null,
        },
      ]),
    );
  }

  /**
   * Net debit less credit per account from posted journals in a date span.
   * `from` null: from the beginning. The year-end closing entry is left out
   * unless asked for: it would zero the P&L it closes.
   */
  async nets(orgId: string, span: { from?: string | null; to: string; includeClosing?: boolean; only?: Types.ObjectId[]; except?: Types.ObjectId[] }): Promise<Map<string, number>> {
    const date: Record<string, string> = { $lte: span.to };
    if (span.from) date.$gte = span.from;
    const match: Record<string, unknown> = { orgId, status: JournalStatus.POSTED, date };
    if (!span.includeClosing) match.isClosingEntry = { $ne: true };
    if (span.only) match._id = { $in: span.only };
    else if (span.except?.length) match._id = { $nin: span.except };
    const rows = await this.journals
      .aggregate<{ _id: Types.ObjectId; net: number; dr: number; cr: number }>([
        { $match: match },
        { $unwind: '$lines' },
        { $group: { _id: '$lines.accountId', net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } }, dr: { $sum: '$lines.debitPaise' }, cr: { $sum: '$lines.creditPaise' } } },
      ])
      .exec();
    return new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r.net]));
  }

  /** The vouchers that brought in opening balances: where the books start, not money that moved. */
  async openingJournalIds(orgId: string): Promise<Types.ObjectId[]> {
    if (!this.batchModel) return [];
    const batches = await this.batchModel.find({ orgId, status: 'committed', journalId: { $ne: null } }, { journalId: 1 }).lean().exec();
    return batches.map((b) => b.journalId).filter((id): id is Types.ObjectId => !!id);
  }

  /** Debits and credits per account in a date span, for the general ledger. */
  async movements(orgId: string, span: { from: string; to: string; includeClosing?: boolean }): Promise<Map<string, { dr: number; cr: number }>> {
    const match: Record<string, unknown> = { orgId, status: JournalStatus.POSTED, date: { $gte: span.from, $lte: span.to } };
    if (span.includeClosing === false) match.isClosingEntry = { $ne: true };
    const rows = await this.journals
      .aggregate<{ _id: Types.ObjectId; dr: number; cr: number }>([
        { $match: match },
        { $unwind: '$lines' },
        { $group: { _id: '$lines.accountId', dr: { $sum: '$lines.debitPaise' }, cr: { $sum: '$lines.creditPaise' } } },
      ])
      .exec();
    return new Map(rows.filter((r) => r._id).map((r) => [String(r._id), { dr: r.dr, cr: r.cr }]));
  }

  /** Names by id from one of the party or item collections. */
  async names(model: 'customers' | 'vendors' | 'items' | 'projects', orgId: string, ids: unknown[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter(Boolean).map(String))].filter((id) => Types.ObjectId.isValid(id));
    if (!list.length) return new Map();
    const m = (model === 'projects' ? this.projects : this[model]) as unknown as Model<{ name: string }>;
    const rows = await m.find({ orgId, _id: { $in: list } }, { name: 1 }).lean().exec();
    return new Map(rows.map((r) => [String(r._id), r.name]));
  }

  /** People's names by user id; ids that are not users come back as they are. */
  async userNames(ids: unknown[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter(Boolean).map(String))].filter((id) => Types.ObjectId.isValid(id) && id.length === 24);
    if (!list.length || !this.userModel) return new Map();
    const rows = await this.userModel.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean().exec();
    return new Map(rows.map((u) => [String(u._id), u.name || u.email]));
  }
}
