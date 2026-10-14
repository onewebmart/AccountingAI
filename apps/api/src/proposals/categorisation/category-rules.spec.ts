/**
 * Unit tests — categorisation rules and bank narration parsing.
 *
 *  ✓ An HSN/SAC code beats a keyword, and says why
 *  ✓ Keywords only apply in the direction they make sense
 *  ✓ Words inside other words do not match
 *  ✓ The counterparty is read out of UPI, NEFT and card narrations
 */
import { counterpartyFrom, ruleFor } from './category-rules';

describe('ruleFor', () => {
  it('reads the HSN/SAC code first', () => {
    expect(ruleFor({ kind: 'bill', partyName: 'Airtel', lines: [{ description: 'Office rent', hsnSac: '997212' }] })).toMatchObject({
      code: '6100', name: 'Rent', reason: 'HSN/SAC 997212 is renting of property',
    });
    expect(ruleFor({ kind: 'bill', lines: [{ hsnSac: '998361' }] })?.name).toBe('Advertising & Marketing');
    expect(ruleFor({ kind: 'bill', lines: [{ hsnSac: '8471 30' }] })?.name).toBe('Office Equipment');
  });

  it('falls back to words, in the right direction', () => {
    expect(ruleFor({ kind: 'withdrawal', narration: 'SMS ALERT CHRG FOR QTR' })?.name).toBe('Bank Charges');
    expect(ruleFor({ kind: 'deposit', narration: 'SMS ALERT CHRG FOR QTR' })).toBeNull();
    expect(ruleFor({ kind: 'deposit', narration: 'INT.PD:01-07-2026 TO 30-09-2026' })?.name).toBe('Other Income');
    expect(ruleFor({ kind: 'bill', partyName: 'Maharashtra State Electricity Distribution (MSEDCL)' })?.name).toBe('Electricity & Utilities');
    expect(ruleFor({ kind: 'withdrawal', narration: 'NEFT/SALARY SEP 2026/RAVI KUMAR' })?.name).toBe('Salaries & Wages');
  });

  it('does not match a word inside another word', () => {
    expect(ruleFor({ kind: 'withdrawal', narration: 'CURRENT ACCOUNT TRANSFER' })).toBeNull();
    expect(ruleFor({ kind: 'bill', partyName: 'Discharge Pumps Pvt Ltd' })).toBeNull();
  });
});

describe('counterpartyFrom', () => {
  it('finds the party in common narrations', () => {
    expect(counterpartyFrom('UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Payment')).toBe('SWIGGY');
    expect(counterpartyFrom('NEFT DR-HDFC0001234-ACME CORP-NETBANK, MUM-N123456789')).toBe('ACME CORP');
    expect(counterpartyFrom('POS 512345XXXXXX1234 AMAZON PAY IN')).toBe('AMAZON');
    expect(counterpartyFrom('ACH D- BAJAJ FINANCE LTD-000123456')).toBe('BAJAJ FINANCE');
    expect(counterpartyFrom('123456789012')).toBeNull();
  });
});
