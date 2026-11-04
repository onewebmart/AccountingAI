/**
 * Unit tests — HSN/SAC rules, the model's answer checked, and line amounts
 * split across accounts.
 *
 *  ✓ Well-formed HSN for goods, SAC for services
 *  ✓ Rules: services before the goods they mention; no rate where it is not certain
 *  ✓ The model's answer: malformed codes, wrong kind and off-slab rates dropped; confidence capped
 *  ✓ Taxable value split across accounts to the paise, adding back exactly
 */
import { hsnProblem, nameKey, ruleGuess } from './hsn';
import { MODEL_CONFIDENCE_CAP, hsnPrompt, readHsnAnswer } from './hsn-model';
import { splitByAccount } from './line-accounts';

describe('HSN and SAC codes', () => {
  it('knows a well-formed code for goods from one for services', () => {
    expect(hsnProblem('8471', 'goods')).toBeNull();
    expect(hsnProblem('847130', 'goods')).toBeNull();
    expect(hsnProblem('84713010', 'goods')).toBeNull();
    expect(hsnProblem('84713', 'goods')).toMatch(/4, 6 or 8/);
    expect(hsnProblem('998314', 'goods')).toMatch(/services/);
    expect(hsnProblem('998314', 'service')).toBeNull();
    expect(hsnProblem('8471', 'service')).toMatch(/starts with 99/);
    expect(hsnProblem('84 71', 'goods')).toMatch(/digits only/);
  });

  it('matches services before the goods they mention', () => {
    expect(ruleGuess('Laptop repair, October')).toMatchObject({ hsnSac: '998713', kind: 'service', uqc: 'NA' });
    expect(ruleGuess('Dell Latitude laptop')).toMatchObject({ hsnSac: '8471', kind: 'goods', gstRatePct: 18, uqc: 'NOS' });
    expect(ruleGuess('Website development – phase 2')).toMatchObject({ hsnSac: '998314', gstRatePct: 18 });
    expect(ruleGuess('Office rent for November')).toMatchObject({ hsnSac: '997212' });
    expect(ruleGuess('Statutory audit fee FY 2025-26')).toMatchObject({ hsnSac: '998221' });
    expect(ruleGuess('Cement OPC 53')).toMatchObject({ hsnSac: '2523', uqc: 'BAG' });
    expect(ruleGuess('Saffron threads')).toBeNull();
    expect(ruleGuess('   ')).toBeNull();
  });

  it('leaves the rate out where it depends on more than the name', () => {
    expect(ruleGuess('Freight charges Mumbai to Pune')).toMatchObject({ hsnSac: '996511', gstRatePct: null });
    expect(ruleGuess('Team lunch catering')).toMatchObject({ hsnSac: '996331', gstRatePct: null });
    expect(ruleGuess('Office chair')).toMatchObject({ hsnSac: '9401', gstRatePct: null });
  });

  it('reads names the same however they are typed', () => {
    expect(nameKey('  Dell  Laptop—15" ')).toBe('dell laptop 15');
  });
});

describe("the model's answer", () => {
  it('keeps a well-formed answer, with the confidence capped', () => {
    expect(readHsnAnswer({ hsnSac: '0910 30', kind: 'goods', gstRatePct: 5, uqc: 'kgs', confidence: 0.97, reason: 'Turmeric' }, null)).toEqual({
      hsnSac: '091030', kind: 'goods', gstRatePct: 5, uqc: 'KGS', confidence: MODEL_CONFIDENCE_CAP, reason: 'Turmeric',
    });
    // A service's unit is NA whatever the model says.
    expect(readHsnAnswer({ hsnSac: '998599', gstRatePct: 18, uqc: 'NOS', confidence: 0.4 }, null)).toMatchObject({ kind: 'service', uqc: 'NA', confidence: 0.4 });
  });

  it('drops what cannot be right', () => {
    expect(readHsnAnswer({ hsnSac: '12', kind: 'goods' }, null)).toBeNull();
    expect(readHsnAnswer({ hsnSac: '998314', kind: 'goods' }, null)).toBeNull();
    expect(readHsnAnswer({ hsnSac: '8471', kind: 'goods' }, 'service')).toBeNull();
    expect(readHsnAnswer('not json', null)).toBeNull();
    // An off-slab rate is dropped, the code kept.
    expect(readHsnAnswer({ hsnSac: '8471', kind: 'goods', gstRatePct: 17 }, null)).toMatchObject({ hsnSac: '8471', gstRatePct: null, uqc: 'NOS' });
  });

  it('asks with the item and only the item', () => {
    const prompt = hsnPrompt({ name: 'Turmeric powder', description: '1 kg packs', kind: 'goods' });
    expect(prompt).toContain('Item: Turmeric powder');
    expect(prompt).toContain('Description: 1 kg packs');
  });
});

describe('splitting by account', () => {
  it('shares the taxable value by line amount, to the paise', () => {
    const parts = splitByAccount(100001, [
      { amountPaise: 1, accountId: 'consulting' },
      { amountPaise: 1, accountId: null },
      { amountPaise: 1, accountId: 'consulting' },
    ], 'sales');
    expect(parts).toEqual([{ accountId: 'consulting', projectId: null, amountPaise: 66667 }, { accountId: 'sales', projectId: null, amountPaise: 33334 }]);
    expect(parts.reduce((s, p) => s + p.amountPaise, 0)).toBe(100001);
  });

  it('is one line to the default when no line has an account', () => {
    expect(splitByAccount(5000, [{ amountPaise: 3000 }, { amountPaise: 2000, accountId: null }], 'sales')).toEqual([{ accountId: 'sales', projectId: null, amountPaise: 5000 }]);
    expect(splitByAccount(5000, [], 'sales')).toEqual([{ accountId: 'sales', projectId: null, amountPaise: 5000 }]);
  });

  it('keeps lines on different projects apart, on the same account', () => {
    expect(splitByAccount(10000, [{ amountPaise: 6000, projectId: 'web' }, { amountPaise: 3000 }, { amountPaise: 1000, projectId: 'web' }], 'sales')).toEqual([
      { accountId: 'sales', projectId: 'web', amountPaise: 7000 },
      { accountId: 'sales', projectId: null, amountPaise: 3000 },
    ]);
  });
});
