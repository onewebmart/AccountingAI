/**
 * Tests — the monthly narrative and Ask your books (pure).
 *
 *  ✓ Figures: a sentence passes only with numbers the code computed; years and small counts pass
 *  ✓ Narrative facts: profit and its change, income against last year, what moved, late payers, overdue, cash
 *  ✓ The model's narrative: sentences with a figure of their own, or citing nothing, are dropped
 *  ✓ Periods read from a question; the account a question names
 *  ✓ The common questions go to the right report by rules
 *  ✓ Rule answers cite the rows they use
 *  ✓ The model's plan is kept only for a real report and a real account; its answer only with figures in the rows it cites
 */
import { AccountType } from '@ai-accounting/shared';
import { figuresKnown, inr, numbersIn } from './figures';
import { NarrativeInput, narrativeFacts, readNarrative, ruleNarrative } from './narrative';
import { accountIn, parseQuestion, periodIn, readAnswer, readPlan, ruleAnswer } from './ask';
import { AccountMeta, ageingByParty, byParty, comparison } from './management';

const TODAY = '2026-11-04';

describe('figures', () => {
  it('reads numbers as written, and passes only known ones', () => {
    expect(numbersIn('Profit was ₹1,25,000.50, up 18% on three months')).toEqual([125000.5, 18, 3]);
    expect(inr(1_25_000_00)).toBe('₹1,25,000');
    expect(inr(1_25_000_50)).toBe('₹1,25,000.50');
    expect(figuresKnown('Profit was ₹1,25,000, up 18% in Oct 2026.', [125000, 18.2])).toBe(true);
    expect(figuresKnown('Profit was ₹1,30,000.', [125000])).toBe(false);
    expect(figuresKnown('Sales will grow 40% next month.', [18])).toBe(false);
  });
});

const pl = (income: number, expenses: number, accounts: Array<[string, string, number]> = []) => ({ income, expenses, byAccount: new Map(accounts.map(([id, name, amount]) => [id, { name, amount }])) });
const input: NarrativeInput = {
  period: '2026-10',
  current: pl(5_00_000_00, 4_10_000_00, [['sales', 'Sales Revenue', 5_00_000_00], ['freight', 'Freight & Carriage', 60_000_00], ['rent', 'Rent', 50_000_00]]),
  previous: pl(5_00_000_00, 3_90_000_00, [['sales', 'Sales Revenue', 5_00_000_00], ['freight', 'Freight & Carriage', 25_000_00], ['rent', 'Rent', 50_000_00]]),
  lastYear: pl(4_00_000_00, 3_00_000_00),
  receivables: { owedPaise: 3_00_000_00, overduePaise: 1_20_000_00, over90Paise: 20_000_00 },
  payables: { overduePaise: 0 },
  latePayers: [{ name: 'Asha Traders', recentDays: 48, usualDays: 30 }],
  cash: { endPaise: 2_40_000_00, previousEndPaise: 2_80_000_00 },
};

describe('narrative', () => {
  it('states the month from computed figures, weightiest first', () => {
    const facts = narrativeFacts(input);
    expect(facts.map((f) => f.id)).toEqual(['profit', 'income', 'mover_1', 'late_payers', 'expenses', 'overdue', 'cash']);
    expect(facts[0].text).toBe('Profit for Oct 2026 was ₹90,000, down 18% on the month before (₹1,10,000).');
    expect(facts[1].text).toBe('Income was ₹5,00,000, the same as the month before and up 25% on Oct 2025.');
    expect(facts[2].text).toBe('Freight & Carriage more than doubled, from ₹25,000 to ₹60,000.');
    expect(facts[3].text).toBe('1 customer is paying later than usual: Asha Traders (48 days, against 30).');
    expect(facts.find((f) => f.id === 'cash')!.text).toBe("Cash and bank stood at ₹2,40,000 at the month's end, down ₹40,000 on the month before.");
    expect(ruleNarrative(facts)).toHaveLength(5);
  });

  it("keeps the model's sentences only when every figure is in the facts they cite", () => {
    const facts = narrativeFacts(input);
    const read = readNarrative({
      sentences: [
        { text: 'Profit fell 18% to ₹90,000 because freight more than doubled, from ₹25,000 to ₹60,000.', facts: ['profit', 'mover_1'] },
        { text: 'Asha Traders now takes 48 days to pay, against 30 before.', facts: ['late_payers'] },
        { text: 'Profit should recover to ₹1,50,000 next month.', facts: ['profit'] },
        { text: 'Things went well.', facts: [] },
      ],
    }, facts);
    expect(read).toEqual({ sentences: ['Profit fell 18% to ₹90,000 because freight more than doubled, from ₹25,000 to ₹60,000.', 'Asha Traders now takes 48 days to pay, against 30 before.'], dropped: 2 });
    expect(readNarrative('not json', facts)).toEqual({ sentences: [], dropped: 0 });
  });
});

describe('reading a question', () => {
  it('finds the months it asks about', () => {
    expect(periodIn('What was my profit last month?', TODAY)).toEqual({ from: '2026-10', to: '2026-10' });
    expect(periodIn('sales in October', TODAY)).toEqual({ from: '2026-10', to: '2026-10' });
    expect(periodIn('sales in december', TODAY)).toEqual({ from: '2025-12', to: '2025-12' });
    expect(periodIn('sales in Oct 2025', TODAY)).toEqual({ from: '2025-10', to: '2025-10' });
    expect(periodIn('profit for FY 2025-26', TODAY)).toEqual({ from: '2025-04', to: '2026-03' });
    expect(periodIn('profit for 2025-26', TODAY)).toEqual({ from: '2025-04', to: '2026-03' });
    expect(periodIn('sales in 2026-04', TODAY)).toEqual({ from: '2026-04', to: '2026-04' });
    expect(periodIn('GST for Q2', TODAY)).toEqual({ from: '2026-07', to: '2026-09' });
    expect(periodIn('expenses this year', TODAY)).toEqual({ from: '2026-04', to: '2026-11' });
    expect(periodIn('profit last quarter', TODAY)).toEqual({ from: '2026-07', to: '2026-09' });
    expect(periodIn('May I see my sales?', TODAY)).toBeNull();
    expect(periodIn('who owes me', TODAY)).toBeNull();
  });

  it('finds the account it names', () => {
    const accounts = ['Rent', 'Freight & Carriage', 'Salaries & Wages', 'Office & Stationery', 'Sales Revenue'];
    expect(accountIn('How much did we spend on rent?', accounts)).toBe('Rent');
    expect(accountIn('freight costs this year', accounts)).toBe('Freight & Carriage');
    expect(accountIn('what did salaries cost', accounts)).toBe('Salaries & Wages');
    expect(accountIn('how is the weather', accounts)).toBeNull();
  });

  it('sends the common questions to the right report', () => {
    const accounts = ['Rent', 'Freight & Carriage'];
    const tool = (q: string) => parseQuestion(q, TODAY, accounts);
    expect(tool('What was my profit last month?')).toEqual({ tool: 'profit_and_loss', args: { from: '2026-10', to: '2026-10' } });
    expect(tool('Who owes me money?')).toEqual({ tool: 'receivables', args: {} });
    expect(tool('Which bills are due to pay?')).toEqual({ tool: 'payables', args: {} });
    expect(tool('Who are my top customers this year?')).toEqual({ tool: 'sales', args: { by: 'customer', from: '2026-04', to: '2026-11' } });
    expect(tool('Which items sold best last quarter?')).toEqual({ tool: 'sales', args: { by: 'item', from: '2026-07', to: '2026-09' } });
    expect(tool('How much did we spend on rent this year?')).toEqual({ tool: 'account', args: { account: 'Rent', from: '2026-04', to: '2026-11' } });
    expect(tool('What were my expenses in October?')).toEqual({ tool: 'expenses', args: { from: '2026-10', to: '2026-10' } });
    expect(tool('What is my GST for last month?')).toEqual({ tool: 'gst', args: { from: '2026-10', to: '2026-10' } });
    expect(tool('Who are our biggest suppliers?')).toEqual({ tool: 'purchases', args: { by: 'vendor' } });
    expect(tool("What's my bank balance?")).toEqual({ tool: 'cash', args: {} });
    expect(tool('Tell me a joke')).toBeNull();
  });
});

const accounts = new Map<string, AccountMeta>([
  ['sales', { id: 'sales', name: 'Sales Revenue', code: '4100', type: AccountType.INCOME, group: 'Revenue' }],
  ['rent', { id: 'rent', name: 'Rent', code: '6100', type: AccountType.EXPENSE, group: 'Indirect Expenses' }],
]);

describe('answers', () => {
  it('answers from the rows by rules, and cites them', () => {
    const t = comparison({ current: new Map([['sales', 1_20_000_00], ['rent', 30_000_00]]), previous: new Map([['sales', 1_00_000_00], ['rent', 30_000_00]]), lastYear: new Map() }, accounts, { current: 'Oct 2026', previous: 'Sep 2026', lastYear: 'Oct 2025' });
    const a = ruleAnswer({ tool: 'profit_and_loss', args: {} }, t);
    expect(a.answer).toBe('Net profit for Oct 2026 was ₹90,000: income ₹1,20,000 less expenses ₹30,000. It was ₹70,000 for Sep 2026.');
    expect(a.rows.map((i) => t.rows[i].cells[0])).toEqual(['Total income', 'Total expenses', 'Net profit']);

    const owed = ageingByParty('receivables', [{ partyId: 'a', partyName: 'Asha Traders', date: '2026-10-01', dueDate: '2026-10-15', owedPaise: 50_000_00 }, { partyId: 'b', partyName: 'Bharat Stores', date: '2026-11-01', dueDate: '2026-11-30', owedPaise: 20_000_00 }], [], TODAY);
    expect(ruleAnswer({ tool: 'receivables', args: {} }, owed).answer).toBe('Customers owe ₹70,000; ₹50,000 of it is overdue. The most is owed by Asha Traders (₹50,000).');

    const top = byParty('sales', [{ partyId: 'a', partyName: 'Asha Traders', date: '2026-10-01', taxablePaise: 3_00_000_00, gstPaise: 0 }, { partyId: 'b', partyName: 'Bharat Stores', date: '2026-10-02', taxablePaise: 1_00_000_00, gstPaise: 0 }], [], 'Oct 2026');
    expect(ruleAnswer({ tool: 'sales', args: { by: 'customer' } }, top).answer).toBe('The top customers for Oct 2026: Asha Traders (₹3,00,000) and Bharat Stores (₹1,00,000). Net sales in all: ₹4,00,000.');
  });

  it("keeps the model's plan only for a real report and account, and its answer only with figures from the cited rows", () => {
    const names = ['Rent', 'Sales Revenue'];
    expect(readPlan({ tool: 'sales', args: { by: 'item', from: '2026-07', to: '2026-09' } }, names, TODAY)).toEqual({ tool: 'sales', args: { by: 'item', from: '2026-07', to: '2026-09' } });
    expect(readPlan({ tool: 'purchases', args: { by: 'customer' } }, names, TODAY)).toEqual({ tool: 'purchases', args: { by: 'vendor' } });
    expect(readPlan({ tool: 'account', args: { account: 'rent', from: '2026-04', to: '2027-03' } }, names, TODAY)).toEqual({ tool: 'account', args: { account: 'Rent' } });
    expect(readPlan({ tool: 'account', args: { account: 'Petty cash' } }, names, TODAY)).toBeNull();
    expect(readPlan({ tool: 'delete_everything' }, names, TODAY)).toBeNull();
    expect(readPlan(null, names, TODAY)).toBeNull();

    const t = byParty('sales', [{ partyId: 'a', partyName: 'Asha Traders', date: '2026-10-01', taxablePaise: 3_00_000_00, gstPaise: 54_000_00 }], [], 'Oct 2026');
    expect(readAnswer({ answer: 'Asha Traders bought the most in Oct 2026: ₹3,00,000 before GST.', rows: [0] }, t)).toEqual({ answer: 'Asha Traders bought the most in Oct 2026: ₹3,00,000 before GST.', rows: [0] });
    expect(readAnswer({ answer: 'Asha Traders bought ₹3,54,000 with GST.', rows: [0] }, t)).toBeNull();
    expect(readAnswer({ answer: 'Asha Traders bought the most.', rows: [99] }, t)).toBeNull();
  });
});
