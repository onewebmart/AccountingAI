import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AccountType, BillStatus, InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { financialYearOf, PostingService } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { CustomersService } from '../sales/customers.service';
import { VendorsService } from '../purchase/vendors.service';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { SpreadsheetParserService, isSpreadsheet } from '../ingest/spreadsheet-parser.service';
import { gstinProblem } from '../extraction/invoice-checks';
import { ImportBatch, ImportBatchDocument } from './schemas/import-batch.schema';
import {
  AccountGroup,
  AccountRole,
  Classification,
  decodeXmlBuffer,
  ImportPreview,
  mergePreviews,
  parseTables,
  parseTallyXml,
} from './source-parsers';
import { OpeningPlan, planOpening } from './opening-plan';

const ROLE_KEY: Record<AccountRole, SystemAccountKey> = {
  bank: SystemAccountKey.BANK,
  cash: SystemAccountKey.CASH,
  receivable: SystemAccountKey.ACCOUNTS_RECEIVABLE,
  payable: SystemAccountKey.ACCOUNTS_PAYABLE,
  gst_output_cgst: SystemAccountKey.GST_OUTPUT_CGST,
  gst_output_sgst: SystemAccountKey.GST_OUTPUT_SGST,
  gst_output_igst: SystemAccountKey.GST_OUTPUT_IGST,
  gst_output_cess: SystemAccountKey.GST_OUTPUT_CESS,
  gst_input_cgst: SystemAccountKey.GST_INPUT_CGST,
  gst_input_sgst: SystemAccountKey.GST_INPUT_SGST,
  gst_input_igst: SystemAccountKey.GST_INPUT_IGST,
  gst_input_cess: SystemAccountKey.GST_INPUT_CESS,
  tds_payable: SystemAccountKey.TDS_PAYABLE,
  tds_receivable: SystemAccountKey.TDS_RECEIVABLE,
  retained_earnings: SystemAccountKey.RETAINED_EARNINGS,
  suspense: SystemAccountKey.SUSPENSE,
};

/** The default chart's group each kind of account is filed under. */
const GROUP_CODE: Record<AccountGroup, string> = {
  current_assets: '1000',
  fixed_assets: '1500',
  liabilities: '2000',
  capital: '3000',
  income: '4000',
  direct_expenses: '5000',
  indirect_expenses: '6000',
};
const GROUP_TYPE: Record<AccountGroup, AccountType> = {
  current_assets: AccountType.ASSETS,
  fixed_assets: AccountType.ASSETS,
  liabilities: AccountType.LIABILITIES,
  capital: AccountType.CAPITAL,
  income: AccountType.INCOME,
  direct_expenses: AccountType.EXPENSE,
  indirect_expenses: AccountType.EXPENSE,
};

const SOURCE_LABEL = { tally: 'Tally', zoho: 'Zoho Books', quickbooks: 'QuickBooks', spreadsheet: 'a spreadsheet', manual: 'the opening balances form' } as const;
/** How the opening journal and documents describe where the balances came from. */
const fromSource = (source: keyof typeof SOURCE_LABEL) =>
  source === 'manual' ? 'entered by hand' : `imported from ${SOURCE_LABEL[source]}`;

/** Our ledgers' system keys, back to the import roles that post to them. */
const KEY_ROLE = new Map<string, AccountRole>(Object.entries(ROLE_KEY).map(([role, key]) => [key, role as AccountRole]));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ManualOpeningInput {
  accounts?: Array<{ accountId: string; debitPaise: number; creditPaise: number }>;
  /** Positive: the customer owes us, or we owe the vendor. Negative: an advance. */
  parties?: Array<{ kind: 'customer' | 'vendor'; partyId: string; balancePaise: number }>;
}

/** Where an account of our chart sits, in the import's terms. */
function groupOf(type: AccountType, parentCode: string | undefined): AccountGroup {
  switch (type) {
    case AccountType.ASSETS:
      return parentCode?.startsWith('15') ? 'fixed_assets' : 'current_assets';
    case AccountType.LIABILITIES:
      return 'liabilities';
    case AccountType.CAPITAL:
      return 'capital';
    case AccountType.INCOME:
      return 'income';
    default:
      return parentCode?.startsWith('5') ? 'direct_expenses' : 'indirect_expenses';
  }
}

export interface CommitInput {
  openingDate: string;
  /** What the person said an unrecognised account is, by account name. */
  groups?: Record<string, AccountGroup>;
  /** Post a difference to Suspense rather than refuse. Off unless chosen. */
  differenceToSuspense?: boolean;
}

/**
 * Moving books in from Tally, Zoho Books or QuickBooks.
 *
 * A preview reads the files and keeps what it found; nothing is written to
 * the books. Committing creates the accounts, customers and vendors that are
 * not here yet, posts one balanced opening journal, and opens a document for
 * each party's balance so receivables, payables and ageing work from the
 * first day. The opening documents are not new supplies, so GST returns leave
 * them out.
 */
@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectModel(ImportBatch.name) private batchModel: Model<ImportBatchDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    private spreadsheets: SpreadsheetParserService,
    private accounts: AccountsService,
    private posting: PostingService,
    private audit: AuditService,
    private customers: CustomersService,
    private vendors: VendorsService,
  ) {}

  async preview(orgId: string, actorId: string, files: Array<{ originalname: string; mimetype: string; buffer: Buffer }>) {
    if (files.length === 0) throw new BadRequestException('Upload at least one file.');
    const previews: ImportPreview[] = [];
    for (const file of files) {
      if (/\.xml$/i.test(file.originalname) || /xml/.test(file.mimetype)) {
        previews.push(parseTallyXml(decodeXmlBuffer(file.buffer)));
      } else if (isSpreadsheet(file.mimetype, file.originalname)) {
        previews.push(parseTables(await this.spreadsheets.parse(file.buffer, file.originalname), file.originalname));
      } else {
        throw new BadRequestException(`${file.originalname}: upload Tally XML, or CSV or Excel exports.`);
      }
    }
    const merged = mergePreviews(previews);

    // A GSTIN that fails its check digit is dropped here, with a word, rather
    // than failing the whole import on commit.
    for (const party of merged.parties) {
      if (party.gstin && gstinProblem(party.gstin)) {
        merged.warnings.push(`${party.name}: GSTIN ${party.gstin} ${gstinProblem(party.gstin)} — left off.`);
        party.gstin = null;
      }
    }
    if (merged.accounts.length === 0 && merged.parties.length === 0) {
      throw new BadRequestException(merged.warnings[0] ?? 'Nothing to import was found in those files.');
    }

    const batch = await this.batchModel.create({
      orgId,
      source: merged.source,
      fileNames: files.map((f) => f.originalname),
      accounts: merged.accounts,
      parties: merged.parties,
      warnings: merged.warnings,
      createdBy: actorId,
    });
    return this.view(batch);
  }

  /**
   * Opening balances typed in over the org's own chart, customers and
   * vendors. They become an import batch like any other, so they are
   * previewed, must balance, and commit through the same path: one opening
   * journal, and a document per party balance.
   *
   * Receivables and payables are entered per customer and vendor, not on the
   * control accounts: the total is their sum, so the two cannot disagree.
   */
  async manual(orgId: string, actorId: string, input: ManualOpeningInput) {
    await this.accounts.seedDefaults(orgId);
    const chart = await this.accountModel.find({ orgId }).lean().exec();
    const byId = new Map(chart.map((a) => [a._id.toString(), a]));
    const seen = new Set<string>();
    const accounts = [];
    for (const line of input.accounts ?? []) {
      const { debitPaise: dr, creditPaise: cr } = line;
      if (![dr, cr].every((v) => Number.isInteger(v) && v >= 0)) throw new BadRequestException('Amounts must be whole paise, not negative.');
      if (dr > 0 && cr > 0) throw new BadRequestException('An account opens with a debit or a credit balance, not both.');
      if (dr === 0 && cr === 0) continue;
      const account = byId.get(line.accountId);
      if (!account) throw new BadRequestException('One of the accounts is not in your chart.');
      if (seen.has(line.accountId)) throw new BadRequestException(`${account.name} is entered twice.`);
      seen.add(line.accountId);
      if (account.isGroup) throw new BadRequestException(`${account.name} is a group. Enter balances on the accounts under it.`);
      if (account.isActive === false) throw new BadRequestException(`${account.name} is deactivated.`);
      const role = account.systemKey ? KEY_ROLE.get(account.systemKey) ?? null : null;
      if (role === 'receivable' || role === 'payable') {
        throw new BadRequestException(`Enter ${role === 'receivable' ? 'receivables per customer' : 'payables per vendor'}; ${account.name} opens at their total.`);
      }
      const parent = account.parentId ? byId.get(account.parentId.toString()) : undefined;
      accounts.push({
        name: account.name,
        code: account.code,
        classification: { type: account.type, group: groupOf(account.type, parent?.code), role },
        sourceType: null,
        balancePaise: dr - cr,
      });
    }

    const parties = [];
    const seenParties = new Set<string>();
    for (const line of input.parties ?? []) {
      if (!Number.isInteger(line.balancePaise)) throw new BadRequestException('Amounts must be whole paise.');
      if (line.balancePaise === 0) continue;
      if (!Types.ObjectId.isValid(line.partyId) || seenParties.has(`${line.kind}:${line.partyId}`)) {
        throw new BadRequestException('Each customer and vendor can be entered once.');
      }
      seenParties.add(`${line.kind}:${line.partyId}`);
      const party =
        line.kind === 'customer'
          ? await this.customerModel.findOne({ _id: line.partyId, orgId }).lean().exec()
          : await this.vendorModel.findOne({ _id: line.partyId, orgId }).lean().exec();
      if (!party) throw new BadRequestException(`That ${line.kind} is not one of yours.`);
      parties.push({ name: party.name, kind: line.kind, gstin: party.gstin ?? null, email: party.email ?? null, phone: party.phone ?? null, balancePaise: line.balancePaise });
    }
    if (accounts.length === 0 && parties.length === 0) throw new BadRequestException('Enter at least one opening balance.');

    const warnings: string[] = [];
    const earlier = await this.batchModel.findOne({ orgId, status: 'committed' }).sort({ updatedAt: -1 }).lean().exec();
    if (earlier) {
      warnings.push(
        `Opening balances were already brought in as at ${earlier.openingDate}. These are added to them as a second opening entry, so enter only what that one missed.`,
      );
    }
    const batch = await this.batchModel.create({ orgId, source: 'manual', fileNames: [], accounts, parties, warnings, createdBy: actorId });
    await this.audit.record({
      orgId, entityType: 'ImportBatch', entityId: batch._id.toString(), action: 'CREATE', performedBy: actorId,
      after: { source: 'manual', accounts: accounts.length, parties: parties.length },
    });
    return this.view(batch);
  }

  async get(orgId: string, id: string) {
    return this.view(await this.find(orgId, id));
  }

  async list(orgId: string) {
    const batches = await this.batchModel.find({ orgId }).sort({ createdAt: -1 }).limit(20).lean().exec();
    return batches.map((b) => ({
      _id: b._id.toString(),
      source: b.source,
      fileNames: b.fileNames,
      status: b.status,
      openingDate: b.openingDate,
      result: b.result,
      createdAt: (b as unknown as { createdAt: Date }).createdAt,
    }));
  }

  async commit(orgId: string, actorId: string, id: string, input: CommitInput) {
    if (!DATE.test(input.openingDate ?? '')) throw new BadRequestException('openingDate must be a date like 2026-04-01');
    const claimed = await this.batchModel
      .findOneAndUpdate({ _id: id, orgId, status: 'previewed' }, { $set: { status: 'committing', lastError: null } }, { new: true })
      .exec();
    if (!claimed) {
      const existing = await this.find(orgId, id);
      throw new BadRequestException(`This import is already ${existing.status}.`);
    }

    try {
      const result = await this.apply(orgId, actorId, claimed, input);
      await this.batchModel.updateOne(
        { _id: claimed._id, orgId },
        { $set: { status: 'committed', openingDate: input.openingDate, journalId: result.journalId, result: result.counts, committedBy: actorId } },
      );
      await this.audit.record({
        orgId,
        entityType: 'ImportBatch',
        entityId: id,
        action: 'COMMIT',
        performedBy: actorId,
        after: { source: claimed.source, openingDate: input.openingDate, journalId: result.journalId?.toString() ?? null, ...result.counts },
      });
      return this.get(orgId, id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.batchModel.updateOne({ _id: claimed._id, orgId }, { $set: { status: 'previewed', lastError: message } });
      throw err;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async apply(orgId: string, actorId: string, batch: ImportBatchDocument, input: CommitInput) {
    // The person's word on accounts the parser could not place.
    const accountsIn = batch.accounts.map((a) => {
      const group = input.groups?.[a.name];
      if (!group || !GROUP_TYPE[group]) return a;
      return { ...a, classification: { type: GROUP_TYPE[group], group, role: a.classification?.role ?? null } as Classification };
    });
    const unplaced = accountsIn.filter((a) => !a.classification && a.balancePaise !== 0);
    if (unplaced.length) {
      throw new BadRequestException(
        `Say what ${unplaced.length === 1 ? 'this account is' : 'these accounts are'} first: ${unplaced.slice(0, 5).map((a) => a.name).join(', ')}${unplaced.length > 5 ? '…' : ''}.`,
      );
    }
    const plan = planOpening(accountsIn, batch.parties);
    if (plan.differencePaise !== 0 && !input.differenceToSuspense) {
      throw new BadRequestException(
        `The opening balances are out by ${(Math.abs(plan.differencePaise) / 100).toFixed(2)} ${plan.differencePaise > 0 ? 'debit' : 'credit'}. ` +
          'Check the files, or choose to post the difference to Suspense.',
      );
    }

    // Masters first: accounts and parties that are not here yet.
    await this.accounts.seedDefaults(orgId);
    const chart = await this.accountModel.find({ orgId }).lean().exec();
    const groups = new Map(chart.filter((a) => a.isGroup).map((a) => [a.code, a._id.toString()]));
    const accountIds = new Map<string, string>();
    let accountsCreated = 0;
    let accountsMatched = 0;
    for (const a of accountsIn) {
      if (!a.classification || a.classification.role) continue; // roles post to our own ledgers
      const existing = chart.find((c) => !c.isGroup && same(c.name, a.name));
      if (existing) {
        accountIds.set(a.name, existing._id.toString());
        accountsMatched += 1;
        continue;
      }
      const created = await this.accounts.create({
        orgId,
        actorId,
        name: a.name,
        type: a.classification.type,
        parentId: groups.get(GROUP_CODE[a.classification.group]) ?? null,
      });
      accountIds.set(a.name, created._id.toString());
      accountsCreated += 1;
    }

    const partyIds = new Map<string, Types.ObjectId>();
    let customersCreated = 0;
    let vendorsCreated = 0;
    let partiesMatched = 0;
    for (const p of batch.parties) {
      const filter = {
        orgId,
        $or: [...(p.gstin ? [{ gstin: p.gstin }] : []), { name: new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
      };
      const found =
        p.kind === 'customer'
          ? await this.customerModel.findOne(filter).lean().exec()
          : await this.vendorModel.findOne(filter).lean().exec();
      if (found) {
        partyIds.set(`${p.kind}:${p.name}`, found._id);
        partiesMatched += 1;
        continue;
      }
      const details = { orgId, actorId, name: p.name, gstin: p.gstin, email: p.email, phone: p.phone };
      const created = p.kind === 'customer' ? await this.customers.create(details) : await this.vendors.create(details);
      partyIds.set(`${p.kind}:${p.name}`, created._id);
      if (p.kind === 'customer') customersCreated += 1;
      else vendorsCreated += 1;
    }

    // Then the balances: one journal, and a document per party balance, together.
    const { journalId, documentsCreated } = await this.posting.inTransaction(async (session) => {
      const journal = await this.postOpening(orgId, actorId, batch, plan, accountIds, input, session);
      const fy = financialYearOf(input.openingDate);
      const prefix = `OPENING/${fy}/`;
      const taken = await Promise.all([
        this.invoiceModel.find({ orgId, invoiceNumber: { $regex: `^${prefix.replace(/\//g, '\\/')}` } }, { invoiceNumber: 1 }).session(session).lean().exec(),
        this.billModel.find({ orgId, billNumber: { $regex: `^${prefix.replace(/\//g, '\\/')}` } }, { billNumber: 1 }).session(session).lean().exec(),
      ]);
      const last = Math.max(
        0,
        ...taken[0].map((d) => Number(String(d.invoiceNumber).slice(prefix.length)) || 0),
        ...taken[1].map((d) => Number(String(d.billNumber).slice(prefix.length)) || 0),
      );
      let created = 0;
      for (const [n, p] of batch.parties.filter((x) => x.balancePaise > 0).entries()) {
        const partyId = partyIds.get(`${p.kind}:${p.name}`)!;
        const number = `${prefix}${String(last + n + 1).padStart(3, '0')}`;
        const amountsPaise = { taxableValue: p.balancePaise, cgst: 0, sgst: 0, igst: 0, cess: 0, total: p.balancePaise };
        const common = { orgId, dueDate: input.openingDate, amountsPaise, financialYear: fy, journalId: journal?._id ?? null, postedBy: actorId, isOpeningBalance: true, notes: `Opening balance ${fromSource(batch.source)}` };
        if (p.kind === 'customer') {
          await this.invoiceModel.create([{ ...common, customerId: partyId, invoiceNumber: number, invoiceDate: input.openingDate, status: InvoiceStatus.POSTED }], { session });
        } else {
          await this.billModel.create([{ ...common, vendorId: partyId, billNumber: number, billDate: input.openingDate, status: BillStatus.POSTED }], { session });
        }
        created += 1;
      }
      return { journalId: journal?._id ?? null, documentsCreated: created };
    });

    const advances = batch.parties.filter((p) => p.balancePaise < 0);
    if (advances.length) {
      this.logger.log(`Import ${batch._id}: ${advances.length} party advances are in the ledger totals but have no document.`);
    }
    return { journalId, counts: { accountsCreated, accountsMatched, customersCreated, vendorsCreated, partiesMatched, documentsCreated } };
  }

  private async postOpening(
    orgId: string,
    actorId: string,
    batch: ImportBatchDocument,
    plan: OpeningPlan,
    accountIds: Map<string, string>,
    input: CommitInput,
    session: ClientSession,
  ) {
    if (plan.lines.length === 0) return null;
    const roles = [...new Set(plan.lines.flatMap((l) => ('role' in l.target ? [l.target.role] : [])))];
    if (plan.differencePaise !== 0) roles.push('suspense');
    const sys = await this.accounts.resolveSystemAccounts(orgId, roles.map((r) => ROLE_KEY[r]));
    const lines = plan.lines.map((l) => {
      const accountId = 'role' in l.target ? sys.get(ROLE_KEY[l.target.role])!._id.toString() : accountIds.get(l.target.accountName)!;
      return { accountId, description: l.label, debitPaise: l.debitPaise, creditPaise: l.creditPaise };
    });
    if (plan.differencePaise !== 0) {
      const suspense = sys.get(SystemAccountKey.SUSPENSE)!;
      lines.push({
        accountId: suspense._id.toString(),
        description: 'Difference in opening balances',
        debitPaise: plan.differencePaise < 0 ? -plan.differencePaise : 0,
        creditPaise: plan.differencePaise > 0 ? plan.differencePaise : 0,
      });
    }
    return this.posting.post(
      {
        orgId,
        voucherType: VoucherType.JOURNAL,
        financialYear: financialYearOf(input.openingDate),
        date: input.openingDate,
        narration: `Opening balances ${fromSource(batch.source)}`,
        postedBy: actorId,
        lines,
      },
      session,
    );
  }

  private async find(orgId: string, id: string): Promise<ImportBatchDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Import not found');
    const batch = await this.batchModel.findOne({ _id: id, orgId }).exec();
    if (!batch) throw new NotFoundException('Import not found');
    return batch;
  }

  private view(batch: ImportBatchDocument) {
    const plan = planOpening(batch.accounts, batch.parties);
    return {
      _id: batch._id.toString(),
      source: batch.source,
      fileNames: batch.fileNames,
      status: batch.status,
      accounts: batch.accounts,
      parties: batch.parties,
      warnings: [...batch.warnings, ...plan.notes],
      unplaced: batch.accounts.filter((a) => !a.classification && a.balancePaise !== 0).map((a) => a.name),
      opening: { debitPaise: plan.debitPaise, creditPaise: plan.creditPaise, differencePaise: plan.differencePaise, lines: plan.lines },
      openingDate: batch.openingDate,
      result: batch.result,
      lastError: batch.lastError,
    };
  }
}
