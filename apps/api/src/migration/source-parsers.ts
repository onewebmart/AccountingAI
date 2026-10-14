/**
 * Reading another system's books: Tally's masters XML, and the CSV or Excel
 * exports of Tally, Zoho Books and QuickBooks (trial balance, chart of
 * accounts, contacts, customer and vendor balances).
 *
 * Everything lands in one shape, an ImportPreview: accounts with their type
 * and opening balance, and customers and vendors with what they owe or are
 * owed. Pure functions in integer paise (Invariant 1); nothing is written
 * until a person has looked at the preview and confirmed it.
 */
import { AccountType } from '@ai-accounting/shared';
import { ParsedSheet, normaliseHeader } from '../ingest/spreadsheet-parser.service';

export type AccountGroup =
  | 'current_assets'
  | 'fixed_assets'
  | 'liabilities'
  | 'capital'
  | 'income'
  | 'direct_expenses'
  | 'indirect_expenses';

/** Accounts that are one of ours already, whatever the other system called them. */
export type AccountRole =
  | 'bank'
  | 'cash'
  | 'receivable'
  | 'payable'
  | 'gst_output_cgst'
  | 'gst_output_sgst'
  | 'gst_output_igst'
  | 'gst_output_cess'
  | 'gst_input_cgst'
  | 'gst_input_sgst'
  | 'gst_input_igst'
  | 'gst_input_cess'
  | 'tds_payable'
  | 'tds_receivable'
  | 'retained_earnings'
  | 'suspense';

export interface Classification {
  type: AccountType;
  group: AccountGroup;
  role: AccountRole | null;
}

export interface ImportedAccount {
  name: string;
  code: string | null;
  /** Null until known: the person must say what an account is before it is imported. */
  classification: Classification | null;
  /** What the other system called its type or group. */
  sourceType: string | null;
  /** Opening balance, debit positive and credit negative. */
  balancePaise: number;
}

export interface ImportedParty {
  name: string;
  kind: 'customer' | 'vendor';
  gstin: string | null;
  email: string | null;
  phone: string | null;
  /** What they owe us (customer) or we owe them (vendor); negative is an advance. */
  balancePaise: number;
}

export type ImportSource = 'tally' | 'zoho' | 'quickbooks' | 'spreadsheet';

export interface ImportPreview {
  source: ImportSource;
  accounts: ImportedAccount[];
  parties: ImportedParty[];
  warnings: string[];
}

const GROUP_TYPE: Record<AccountGroup, AccountType> = {
  current_assets: AccountType.ASSETS,
  fixed_assets: AccountType.ASSETS,
  liabilities: AccountType.LIABILITIES,
  capital: AccountType.CAPITAL,
  income: AccountType.INCOME,
  direct_expenses: AccountType.EXPENSE,
  indirect_expenses: AccountType.EXPENSE,
};

const of = (group: AccountGroup, role: AccountRole | null = null): Classification => ({ type: GROUP_TYPE[group], group, role });

/**
 * What an account is, from the type or group another system gave it: Tally's
 * primary groups, Zoho's and QuickBooks' account types. Order matters: "Bank
 * OD" is a liability before it is a bank.
 */
export function classify(label: string | null | undefined): Classification | null {
  const l = (label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!l) return null;
  if (/sundry debtors|accounts? receivable|\(a\/r\)|trade receivables/.test(l)) return of('current_assets', 'receivable');
  if (/sundry creditors|accounts? payable|\(a\/p\)|trade payables/.test(l)) return of('liabilities', 'payable');
  if (/bank od|overdraft|cash credit/.test(l)) return of('liabilities');
  if (/^bank|bank accounts?$/.test(l)) return of('current_assets', 'bank');
  if (/cash[- ]in[- ]hand|^cash$|petty cash/.test(l)) return of('current_assets', 'cash');
  if (/profit ?& ?loss a\/c|retained earnings/.test(l)) return of('capital', 'retained_earnings');
  if (/suspense/.test(l)) return of('indirect_expenses', 'suspense');
  if (/fixed assets?|other assets?$|investments?|capital work/.test(l)) return of('fixed_assets');
  if (/current assets?|stock|inventory|deposits? \(asset\)|loans? ?& ?advances|misc\. expenses \(asset\)|prepaid/.test(l)) return of('current_assets');
  if (/credit card|liabilit|loans?\b|provisions?|duties ?& ?taxes|branch|unsecured|secured/.test(l)) return of('liabilities');
  if (/equity|capital|reserves?|surplus|owner|drawings/.test(l)) return of('capital');
  if (/cost of (goods )?sold|cost of sales|purchase|direct expenses?/.test(l)) return of('direct_expenses');
  if (/income|revenue|sales/.test(l)) return of('income');
  if (/expense/.test(l)) return of('indirect_expenses');
  return null;
}

/**
 * Tax and settlement accounts by name, so balances land on the ledgers the
 * returns and payments read: "Output CGST", "Input IGST", "TDS Payable".
 * A bare "CGST" is output if it is owed (a credit) and input if not.
 */
export function roleFromName(name: string, balancePaise: number): AccountRole | null {
  const n = name.toLowerCase();
  const head = /\bcgst\b/.test(n) ? 'cgst' : /\bsgst|utgst\b/.test(n) ? 'sgst' : /\bigst\b/.test(n) ? 'igst' : /\bcess\b/.test(n) ? 'cess' : null;
  if (head) {
    const side = /\b(input|itc|receivable)\b/.test(n) ? 'input' : /\b(output|payable)\b/.test(n) ? 'output' : balancePaise > 0 ? 'input' : 'output';
    return `gst_${side}_${head}` as AccountRole;
  }
  if (/\btds\b/.test(n)) return /receivable|deducted by|tds on sales|asset/.test(n) ? 'tds_receivable' : 'tds_payable';
  return null;
}

/** Where a tax or settlement role lives in the chart. */
function classificationForRole(role: AccountRole): Classification {
  return role.startsWith('gst_input') || role === 'tds_receivable' ? of('current_assets', role) : of('liabilities', role);
}

/**
 * What an account is from its name alone, when no type came with it (a Tally
 * trial balance exported to Excel). Stricter than classify(): "Bank Charges"
 * is an expense, not a bank.
 */
export function classifyByName(name: string, balancePaise: number): Classification | null {
  const role = roleFromName(name, balancePaise);
  if (role) return classificationForRole(role);
  const n = name.toLowerCase();
  if (/charges?|interest|commission|fees?|discount/.test(n)) return /interest (received|earned|income)|discount received|commission received/.test(n) ? of('income') : of('indirect_expenses');
  if (/\bbank\b|current a\/?c|savings a\/?c|\bod a\/?c/.test(n)) return /\bod\b|overdraft/.test(n) ? of('liabilities') : of('current_assets', 'bank');
  if (/^cash\b|petty cash|cash[- ]in[- ]hand/.test(n)) return of('current_assets', 'cash');
  return classify(name);
}

// ── Tally masters XML ───────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e])
    .trim();
}

function tag(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : null;
}

/** Tally writes XML as UTF-16 with a byte-order mark more often than not. */
export function decodeXmlBuffer(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  if (buffer.length > 1 && buffer[1] === 0x00) return buffer.toString('utf16le');
  return buffer.toString('utf8').replace(/^﻿/, '');
}

/** Rupees as Tally writes them ("-1,25,000.00") → paise, sign kept. */
function rupeesToPaise(raw: string | null): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[,\s₹]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Tally's "All Masters" export: groups (with their parents) and ledgers (with
 * parent group and opening balance). In Tally's XML a debit is negative, so
 * the sign is flipped to ours, where debit is positive.
 */
export function parseTallyXml(xml: string): ImportPreview {
  const warnings: string[] = [];
  const groups = new Map<string, string>();
  for (const m of xml.matchAll(/<GROUP\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/GROUP>/g)) {
    groups.set(decode(m[1]).toLowerCase(), (tag(m[2], 'PARENT') ?? '').replace(/[\u0000-\u001f]/g, '').trim());
  }

  /** Climb to the first group we can classify: the ledger's own, or a parent's. */
  const classifyGroup = (group: string): { classification: Classification | null; primary: string } => {
    let current = group;
    for (let depth = 0; depth < 20 && current; depth++) {
      const c = classify(current);
      if (c) return { classification: c, primary: current };
      const parent = groups.get(current.toLowerCase());
      if (!parent || /primary/i.test(parent)) break;
      current = parent;
    }
    return { classification: null, primary: group };
  };

  const accounts: ImportedAccount[] = [];
  const parties: ImportedParty[] = [];
  for (const m of xml.matchAll(/<LEDGER\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/g)) {
    const name = decode(m[1]);
    const body = m[2];
    const parent = (tag(body, 'PARENT') ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    const balancePaise = -rupeesToPaise(tag(body, 'OPENINGBALANCE'));
    // The Profit & Loss ledger sits at the top of Tally's chart with no group.
    const { classification, primary } = /profit ?& ?loss/i.test(name) ? { classification: classify('Profit & Loss A/c'), primary: 'Primary' } : classifyGroup(parent);

    if (classification?.role === 'receivable' || classification?.role === 'payable') {
      const customer = classification.role === 'receivable';
      parties.push({
        name,
        kind: customer ? 'customer' : 'vendor',
        gstin: (tag(body, 'PARTYGSTIN') ?? tag(body, 'GSTIN'))?.toUpperCase() || null,
        email: tag(body, 'EMAIL'),
        phone: tag(body, 'LEDGERMOBILE') ?? tag(body, 'LEDGERPHONE'),
        // Debtors owe us a debit balance; creditors are owed a credit balance.
        balancePaise: customer ? balancePaise : -balancePaise,
      });
      continue;
    }
    const role = classification && (classification.group === 'liabilities' || classification.group === 'current_assets') ? roleFromName(name, balancePaise) : null;
    accounts.push({
      name,
      code: null,
      classification: classification ? { ...classification, role: role ?? classification.role } : null,
      sourceType: primary || null,
      balancePaise,
    });
  }
  if (accounts.length === 0 && parties.length === 0) {
    warnings.push('No ledgers found. Export "All Masters" from Tally (Gateway of Tally → Export → Masters, XML).');
  }
  return { source: 'tally', accounts, parties, warnings };
}

// ── CSV and Excel exports ───────────────────────────────────────────────────

const COLUMNS = {
  name: ['accountname', 'account', 'ledgername', 'ledger', 'particulars', 'displayname', 'customername', 'vendorname', 'contactname', 'suppliername', 'customer', 'vendor', 'supplier', 'companyname', 'name'],
  code: ['accountcode', 'code', 'accountnumber', 'number'],
  type: ['accounttype', 'type', 'group', 'under', 'parentgroup', 'parent', 'category'],
  debit: ['debit', 'netdebit', 'dr', 'debitbalance', 'closingdebit', 'debitamount'],
  credit: ['credit', 'netcredit', 'cr', 'creditbalance', 'closingcredit', 'creditamount'],
  balance: ['closingbalance', 'openingbalance', 'balance', 'balancedue', 'outstanding', 'total', 'amount'],
  gstin: ['gstin', 'gstidentificationnumbergstin', 'gstno', 'gstnumber', 'gstregistrationnumber', 'gstinuin'],
  email: ['email', 'emailid', 'emailaddress'],
  phone: ['phone', 'mobile', 'mobilephone', 'phonenumber', 'workphone', 'mobilenumber'],
  contactType: ['contacttype'],
} as const;

function column(sheet: ParsedSheet, names: readonly string[]): string | null {
  for (const n of names) if (sheet.headers.includes(n)) return n;
  return null;
}

/** "1,25,000.00 Dr", "(500.00)", "-500" → paise, debit positive. Null when not a number. */
export function signedPaise(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const credit = /\bcr\.?$/i.test(s);
  const paren = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/\b(dr|cr)\.?$/i, '').replace(/[()₹,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return credit || paren ? -Math.abs(paise) : paise;
}

function detectSource(sheets: ParsedSheet[], fileName: string): ImportSource {
  const headers = sheets.flatMap((s) => s.headers);
  const types = sheets.flatMap((s) => s.rows.map((r) => (r.accounttype ?? r.type ?? '').toLowerCase()));
  if (/tally/i.test(fileName) || headers.includes('under') || types.some((t) => /sundry (debtors|creditors)|duties & taxes/.test(t))) return 'tally';
  if (headers.includes('detailtype') || types.some((t) => /\((a\/r|a\/p)\)/.test(t)) || /quickbooks|qbo/i.test(fileName)) return 'quickbooks';
  if (headers.includes('gstidentificationnumbergstin') || headers.includes('displayname') || types.some((t) => /other current (asset|liability)|cost of goods sold/.test(t)) || /zoho/i.test(fileName)) return 'zoho';
  return 'spreadsheet';
}

function partyKindFrom(text: string): 'customer' | 'vendor' | null {
  if (/customer|debtor|receivable|client/i.test(text)) return 'customer';
  if (/vendor|supplier|creditor|payable/i.test(text)) return 'vendor';
  return null;
}

const TOTAL_ROW = /^(grand )?total\b|^difference in opening|^closing balance$|^opening balance$/i;

/**
 * Reads each sheet as a trial balance, a chart of accounts, a contact list or
 * a customer/vendor balance summary, by its columns.
 */
export function parseTables(sheets: ParsedSheet[], fileName: string): ImportPreview {
  const source = detectSource(sheets, fileName);
  const accounts: ImportedAccount[] = [];
  const parties: ImportedParty[] = [];
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const col = {
      name: column(sheet, COLUMNS.name),
      code: column(sheet, COLUMNS.code),
      type: column(sheet, COLUMNS.type),
      debit: column(sheet, COLUMNS.debit),
      credit: column(sheet, COLUMNS.credit),
      balance: column(sheet, COLUMNS.balance),
      gstin: column(sheet, COLUMNS.gstin),
      email: column(sheet, COLUMNS.email),
      phone: column(sheet, COLUMNS.phone),
      contactType: column(sheet, COLUMNS.contactType),
    };
    if (!col.name) {
      warnings.push(`${sheet.name}: no account or name column found — skipped.`);
      continue;
    }
    const nameHeader = sheet.rawHeaders[sheet.headers.indexOf(col.name)] ?? col.name;
    const sheetParty = partyKindFrom(`${fileName} ${sheet.name} ${nameHeader}`);
    const isContacts = !!(col.gstin || col.email || col.phone || col.contactType) || (!!sheetParty && !col.type);
    const amount = (row: Record<string, string>): number | null => {
      if (col.debit || col.credit) {
        const dr = signedPaise(col.debit ? row[col.debit] : undefined);
        const cr = signedPaise(col.credit ? row[col.credit] : undefined);
        if (dr === null && cr === null) return null;
        return Math.abs(dr ?? 0) - Math.abs(cr ?? 0);
      }
      return col.balance ? signedPaise(row[col.balance]) : null;
    };

    for (const row of sheet.rows) {
      const name = (row[col.name] ?? '').trim();
      if (!name || TOTAL_ROW.test(name)) continue;

      if (isContacts) {
        const kind = partyKindFrom(col.contactType ? row[col.contactType] ?? '' : '') ?? sheetParty;
        if (!kind) {
          warnings.push(`${sheet.name}: cannot tell whether "${name}" is a customer or a vendor — skipped. Add a Contact Type column.`);
          continue;
        }
        // Debit/credit (columns or a Dr/Cr suffix) is read by kind: a customer's
        // debit and a vendor's credit are what is owed. A plain figure is what is
        // owed; a minus or brackets, an advance.
        const cell = (col.balance ? row[col.balance] : '')?.trim() ?? '';
        const raw = amount(row) ?? 0;
        const sided = !!(col.debit || col.credit) || /\b(dr|cr)\.?$/i.test(cell);
        parties.push({
          name,
          kind,
          gstin: (col.gstin ? row[col.gstin] : '')?.trim().toUpperCase() || null,
          email: (col.email ? row[col.email] : '')?.trim() || null,
          phone: (col.phone ? row[col.phone] : '')?.trim() || null,
          balancePaise: sided && kind === 'vendor' ? -raw : raw,
        });
        continue;
      }

      const balancePaise = amount(row) ?? 0;
      const sourceType = col.type ? (row[col.type] ?? '').trim() || null : null;
      const classification = classify(sourceType) ?? classifyByName(name, balancePaise);
      const role =
        classification && (classification.group === 'liabilities' || classification.group === 'current_assets')
          ? roleFromName(name, balancePaise)
          : null;
      accounts.push({
        name,
        code: (col.code ? row[col.code] : '')?.trim() || null,
        classification: classification ? { ...classification, role: role ?? classification.role } : null,
        sourceType,
        balancePaise,
      });
    }
  }
  return { source, accounts, parties, warnings };
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Puts several files' worth together: a trial balance's figures with a chart
 * of accounts' types, contacts with their balances. A trial-balance line that
 * names a known customer or vendor is that party's balance, not an account.
 */
export function mergePreviews(previews: ImportPreview[]): ImportPreview {
  const sources = [...new Set(previews.map((p) => p.source))].filter((s) => s !== 'spreadsheet');
  const parties = new Map<string, ImportedParty>();
  for (const party of previews.flatMap((p) => p.parties)) {
    const k = `${party.kind}:${party.gstin ?? key(party.name)}`;
    const byName = [...parties.values()].find((p) => p.kind === party.kind && key(p.name) === key(party.name));
    const existing = parties.get(k) ?? byName;
    if (existing) {
      existing.gstin ??= party.gstin;
      existing.email ??= party.email;
      existing.phone ??= party.phone;
      if (party.balancePaise !== 0) existing.balancePaise = party.balancePaise;
    } else {
      parties.set(k, { ...party });
    }
  }
  const partyNames = new Map([...parties.values()].map((p) => [key(p.name), p]));

  const accounts = new Map<string, ImportedAccount>();
  for (const account of previews.flatMap((p) => p.accounts)) {
    const party = partyNames.get(key(account.name));
    if (party) {
      // In the books a debtor's debit is what they owe; a creditor's credit, what we owe.
      if (party.balancePaise === 0) party.balancePaise = party.kind === 'customer' ? account.balancePaise : -account.balancePaise;
      continue;
    }
    const existing = accounts.get(key(account.name));
    if (existing) {
      existing.classification ??= account.classification;
      existing.sourceType ??= account.sourceType;
      existing.code ??= account.code;
      if (account.balancePaise !== 0) existing.balancePaise = account.balancePaise;
    } else {
      accounts.set(key(account.name), { ...account });
    }
  }
  return {
    source: sources[0] ?? 'spreadsheet',
    accounts: [...accounts.values()],
    parties: [...parties.values()],
    warnings: previews.flatMap((p) => p.warnings),
  };
}
