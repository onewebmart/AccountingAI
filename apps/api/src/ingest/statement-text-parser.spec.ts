/**
 * Unit tests — reading bank statements out of PDF text.
 *
 *  ✓ A statement is told apart from a tax invoice
 *  ✓ Three common layouts read correctly: money in or out comes from the change in balance
 *  ✓ A B/F row sets the opening balance; a first line with no opening reads its narration
 *  ✓ Dates like 01.09.26 are not read as amounts
 *  ✓ Lines that do not add up, or a closing balance the lines miss, are refused with the reason
 *  ✓ A statement read another way is checked line by line
 */
import { accountNumberIn, looksLikeBankStatement, parseStatementText, statementAddsUp } from './statement-text-parser';

const HDFC = `HDFC BANK LTD
Statement of account
Account No : 50100123456789
Statement From : 01/09/2026 To : 30/09/2026
Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance
Opening Balance : 1,00,000.00
01/09/26 UPI-SWIGGY LIMITED-SWIGGY@YBL-YESB0YBLUPI-412345678901-PAYMENT 0000412345678901 01/09/26 450.00 99,550.00
03/09/26 NEFT CR-HDFC0000001-ACME CORP-INV 101 N245260123456789 03/09/26 1,18,000.00 2,17,550.00
05/09/26 SMS ALERT CHRG FOR QTR 05/09/26 17.70 2,17,532.30
Page 1 of 2
10/09/26 ACH D- BAJAJ FINANCE LTD-000123456
EMI SEP 0000000123456 10/09/26 12,500.00 2,05,032.30
STATEMENT SUMMARY
Opening Balance Dr Count Cr Count Debits Credits Closing Bal
Closing Balance : 2,05,032.30`;

const ICICI = `ICICI Bank
DETAILED STATEMENT
A/c No: XXXXXXXX4321
Transaction Date Transaction Remarks Withdrawal Amount (INR ) Deposit Amount (INR ) Balance (INR )
01-09-2026 B/F 25,000.00
02-09-2026 UPI/412345678901/ZOMATO/zomato@hdfc 350.00 0.00 24,650.00
04-09-2026 BY CASH DEPOSIT 0.00 5,000.00 29,650.00
05-09-2026 INT.PD 01-06-2026 TO 31-08-2026 0.00 210.45 29,860.45`;

const SBI = `State Bank of India
Account Statement
Account Number : 00000012345678901
Txn Date Value Date Description Ref No./Cheque No. Debit Credit Balance
1 Sep 2026 1 Sep 2026 TO TRANSFER-UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/UPI 450.00 10,550.00
2 Sep 2026 2 Sep 2026 BY TRANSFER-NEFT*HDFC0000001*N245260123456789*ACME CORP 1,000.00 11,550.00`;

describe('looksLikeBankStatement', () => {
  it('tells a statement from an invoice', () => {
    expect(looksLikeBankStatement(HDFC)).toBe(true);
    expect(looksLikeBankStatement(ICICI)).toBe(true);
    expect(
      looksLikeBankStatement(`TAX INVOICE\nInvoice No: INV-101 Date: 01/09/2026\nGSTIN of the buyer: 27AAPFU0939F1ZV\nHSN 8471 Laptop 1,00,000.00\nCGST 9,000.00 SGST 9,000.00\nTotal 1,18,000.00`),
    ).toBe(false);
  });

  it('does not take a supplier ledger statement for a bank one', () => {
    const ledger = `Sharma Traders
Statement of Account for Rao Textiles
Opening Balance 10,000.00
Date Particulars Debit Credit Balance
01/09/2026 Invoice 101 5,000.00 15,000.00
05/09/2026 Payment received 8,000.00 7,000.00
09/09/2026 Invoice 107 2,000.00 9,000.00
Closing Balance 9,000.00`;
    expect(looksLikeBankStatement(ledger)).toBe(false);
  });
});

describe('parseStatementText', () => {
  it('reads an HDFC-style statement, wrapped narration and all', () => {
    const out = parseStatementText(HDFC);
    if (!out.ok) throw new Error(out.reason);
    const s = out.statement;
    expect(s).toMatchObject({ openingBalancePaise: 10000000, closingBalancePaise: 20503230, accountNumber: '50100123456789', bankName: 'HDFC Bank' });
    expect(s.lines.map((l) => [l.date, l.debitPaise, l.creditPaise, l.runningBalancePaise])).toEqual([
      ['2026-09-01', 45000, 0, 9955000],
      ['2026-09-03', 0, 11800000, 21755000],
      ['2026-09-05', 1770, 0, 21753230],
      ['2026-09-10', 1250000, 0, 20503230],
    ]);
    expect(s.lines[0]).toMatchObject({ reference: '412345678901' });
    expect(s.lines[0].description).toContain('UPI-SWIGGY LIMITED');
    expect(s.lines[3].description).toContain('EMI SEP');
  });

  it('reads an ICICI-style statement with a B/F row and two amount columns', () => {
    const out = parseStatementText(ICICI);
    if (!out.ok) throw new Error(out.reason);
    expect(out.statement).toMatchObject({ openingBalancePaise: 2500000, closingBalancePaise: 2986045, accountNumber: 'XXXXXXXX4321', bankName: 'ICICI Bank' });
    expect(out.statement.lines.map((l) => [l.debitPaise, l.creditPaise])).toEqual([[35000, 0], [0, 500000], [0, 21045]]);
    expect(out.statement.lines[2].description).toBe('INT.PD TO');
  });

  it('reads an SBI-style statement with no opening balance, from the first narration', () => {
    const out = parseStatementText(SBI);
    if (!out.ok) throw new Error(out.reason);
    expect(out.statement).toMatchObject({ openingBalancePaise: 1100000, closingBalancePaise: 1155000, bankName: 'State Bank of India' });
    expect(out.statement.lines.map((l) => [l.date, l.debitPaise, l.creditPaise])).toEqual([
      ['2026-09-01', 45000, 0],
      ['2026-09-02', 0, 100000],
    ]);
  });

  it('does not take a dotted date for an amount', () => {
    const out = parseStatementText(`Opening Balance 1,000.00\n01.09.26 CHQ DEP 01.09.26 500.00 1,500.00\n02.09.26 ATM WDL 02.09.26 200.00 1,300.00`);
    if (!out.ok) throw new Error(out.reason);
    expect(out.statement.lines.map((l) => [l.debitPaise, l.creditPaise])).toEqual([[0, 50000], [20000, 0]]);
  });

  it('refuses lines that do not add up, and a closing balance the lines miss', () => {
    const broken = parseStatementText(HDFC.replace('2,17,550.00', '2,17,500.00'));
    expect(broken).toMatchObject({ ok: false });
    expect(!broken.ok && broken.reason).toMatch(/dated 2026-09-03 does not add up/);

    const missingPage = parseStatementText(HDFC.replace('Closing Balance : 2,05,032.30', 'Closing Balance : 1,95,032.30'));
    expect(!missingPage.ok && missingPage.reason).toMatch(/a page may be missing/);
  });
});

describe('statementAddsUp', () => {
  const line = (debitPaise: number, creditPaise: number, runningBalancePaise: number | null) => ({
    date: '2026-09-01', description: 'x', reference: null, debitPaise, creditPaise, runningBalancePaise,
  });
  it('accepts lines that reach the closing balance, and says where they do not', () => {
    expect(statementAddsUp({ openingBalancePaise: 1000, closingBalancePaise: 1300, lines: [line(0, 500, 1500), line(200, 0, null)] })).toBeNull();
    expect(statementAddsUp({ openingBalancePaise: 1000, closingBalancePaise: 1300, lines: [line(0, 500, 1400), line(200, 0, null)] })).toMatch(/should be 15\.00, not 14\.00/);
    expect(statementAddsUp({ openingBalancePaise: 1000, closingBalancePaise: 9999, lines: [line(0, 500, null)] })).toMatch(/not the closing 99\.99/);
  });
});

describe('accountNumberIn', () => {
  it('keeps masked digits', () => {
    expect(accountNumberIn('A/C No. : XXXX XXXX 1234')).toBe('XXXXXXXX1234');
    expect(accountNumberIn('Account Number: ****5678')).toBe('XXXX5678');
  });
});
