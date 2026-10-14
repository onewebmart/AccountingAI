/**
 * Unit tests — reading other systems' books.
 *
 *  ✓ Tally masters XML: sub-groups climb to their primary group, debits flip sign,
 *    debtors and creditors become customers and vendors, tax ledgers find their role
 *  ✓ UTF-16 Tally files decode
 *  ✓ Zoho and QuickBooks types classify; "Bank Charges" is not a bank
 *  ✓ A trial balance, a chart of accounts and a contact list merge into one preview
 *  ✓ The opening plan balances, and the receivables total wins over party balances
 */
import { AccountType } from '@ai-accounting/shared';
import { ParsedSheet, normaliseHeader } from '../ingest/spreadsheet-parser.service';
import { classify, classifyByName, decodeXmlBuffer, mergePreviews, parseTables, parseTallyXml } from './source-parsers';
import { planOpening } from './opening-plan';
import { TALLY_XML } from './test-fixtures';

function sheet(name: string, rawHeaders: string[], rows: string[][]): ParsedSheet {
  const headers = rawHeaders.map(normaliseHeader);
  return { name, headers, rawHeaders, rows: rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}

describe('parseTallyXml', () => {
  const preview = parseTallyXml(TALLY_XML);

  it('reads ledgers into accounts with our signs and roles', () => {
    expect(preview.source).toBe('tally');
    const byName = Object.fromEntries(preview.accounts.map((a) => [a.name, a]));
    expect(byName['HDFC Bank A/c']).toMatchObject({ balancePaise: 25000000, classification: { role: 'bank' } });
    expect(byName.Cash).toMatchObject({ balancePaise: 1000000, classification: { role: 'cash' } });
    expect(byName['Output CGST']).toMatchObject({ balancePaise: -900000, classification: { role: 'gst_output_cgst' } });
    expect(byName.Furniture).toMatchObject({ balancePaise: 6000000, classification: { group: 'fixed_assets', type: AccountType.ASSETS } });
    expect(byName["Proprietor's Capital"]).toMatchObject({ balancePaise: -37000000, classification: { group: 'capital' } });
    expect(byName['Profit & Loss A/c'].classification?.role).toBe('retained_earnings');
    expect(byName.Sales.classification?.group).toBe('income');
  });

  it('turns debtors and creditors, sub-groups included, into customers and vendors', () => {
    expect(preview.parties).toEqual([
      { name: 'Rao & Sons', kind: 'customer', gstin: '27AAPFU0939F1ZV', email: 'ac@rao.example', phone: null, balancePaise: 11800000 },
      { name: 'Sigma Supplies', kind: 'vendor', gstin: null, email: null, phone: null, balancePaise: 5900000 },
    ]);
  });

  it('decodes the UTF-16 files Tally writes', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TALLY_XML, 'utf16le')]);
    expect(parseTallyXml(decodeXmlBuffer(utf16)).accounts).toHaveLength(preview.accounts.length);
  });

  it('plans a balanced opening entry', () => {
    const plan = planOpening(preview.accounts, preview.parties);
    expect(plan.differencePaise).toBe(0);
    expect(plan.debitPaise).toBe(43800000);
    expect(plan.lines.map((l) => [l.label, l.debitPaise, l.creditPaise])).toEqual([
      ['Furniture', 6000000, 0],
      ["Proprietor's Capital", 0, 37000000],
      ['Bank Accounts', 25000000, 0],
      ['Cash in Hand', 1000000, 0],
      ['Output CGST', 0, 900000],
      ['Accounts Receivable', 11800000, 0],
      ['Accounts Payable', 0, 5900000],
    ]);
  });
});

describe('classification', () => {
  it('knows Zoho and QuickBooks types, and does not take bank charges for a bank', () => {
    expect(classify('Accounts receivable (A/R)')?.role).toBe('receivable');
    expect(classify('Other Current Liability')?.group).toBe('liabilities');
    expect(classify('Cost of Goods Sold')?.group).toBe('direct_expenses');
    expect(classify('Bank OD A/c')?.group).toBe('liabilities');
    expect(classifyByName('Bank Charges', 500)?.group).toBe('indirect_expenses');
    expect(classifyByName('ICICI Bank Current A/c', 500)?.role).toBe('bank');
    expect(classifyByName('Input IGST', 500)?.role).toBe('gst_input_igst');
    expect(classifyByName('Interest Received', -500)?.group).toBe('income');
  });
});

describe('spreadsheets', () => {
  it('merges a Zoho trial balance, chart of accounts and contacts', () => {
    const tb = parseTables(
      [
        sheet('Trial Balance', ['Account', 'Net Debit', 'Net Credit'], [
          ['HDFC Current', '2,00,000.00', ''],
          ['Accounts Receivable', '1,18,000.00', ''],
          ['Rent Deposit', '50,000.00', ''],
          ["Owner's Equity", '', '3,68,000.00'],
          ['Total', '3,68,000.00', '3,68,000.00'],
        ]),
      ],
      'zoho_trial_balance.xlsx',
    );
    const coa = parseTables([sheet('Accounts', ['Account Name', 'Account Code', 'Account Type'], [
      ['HDFC Current', '1001', 'Bank'],
      ['Rent Deposit', '1200', 'Other Current Asset'],
      ["Owner's Equity", '3001', 'Equity'],
    ])], 'Chart_of_Accounts.csv');
    const contacts = parseTables([sheet('Contacts', ['Display Name', 'GST Identification Number (GSTIN)', 'EmailID', 'Contact Type', 'Opening Balance'], [
      ['Rao Traders', '27AAPFU0939F1ZV', 'ac@rao.example', 'customer', '1,00,000.00'],
      ['Mehta Retail', '', '', 'customer', '18,000.00'],
      ['Landlord LLP', '', '', 'vendor', ''],
    ])], 'Contacts.csv');

    const merged = mergePreviews([tb, coa, contacts]);
    expect(merged.source).toBe('zoho');
    expect(merged.accounts.map((a) => [a.name, a.code, a.classification?.role ?? a.classification?.group, a.balancePaise])).toEqual([
      ['HDFC Current', '1001', 'bank', 20000000],
      ['Accounts Receivable', null, 'receivable', 11800000],
      ['Rent Deposit', '1200', 'current_assets', 5000000],
      ["Owner's Equity", '3001', 'capital', -36800000],
    ]);
    expect(merged.parties.map((p) => [p.name, p.kind, p.balancePaise])).toEqual([
      ['Rao Traders', 'customer', 10000000],
      ['Mehta Retail', 'customer', 1800000],
      ['Landlord LLP', 'vendor', 0],
    ]);
    const plan = planOpening(merged.accounts, merged.parties);
    expect(plan.differencePaise).toBe(0);
    expect(plan.notes).toEqual([]);
  });

  it('reads a QuickBooks balance with Dr/Cr, and notes when party balances miss the total', () => {
    const tb = parseTables([sheet('TB', ['Account', 'Type', 'Balance'], [
      ['Accounts Payable (A/P)', 'Accounts payable (A/P)', '45,000.00 Cr'],
      ['Checking', 'Bank', '45,000.00 Dr'],
    ])], 'qbo.csv');
    const vendors = parseTables([sheet('Vendor Balance Summary', ['Vendor', 'Total'], [['Acme', '40,000.00']])], 'vendor_balance_summary.csv');
    const merged = mergePreviews([tb, vendors]);
    expect(merged.source).toBe('quickbooks');
    const plan = planOpening(merged.accounts, merged.parties);
    expect(plan.differencePaise).toBe(0);
    expect(plan.notes[0]).toMatch(/Vendor balances add up to 40,000\.00 but the payables total is 45,000\.00/);
  });
});
