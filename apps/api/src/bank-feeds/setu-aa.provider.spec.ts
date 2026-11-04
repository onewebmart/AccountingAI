/**
 * Unit tests — the Setu Account Aggregator adapter, against a stand-in for
 * Setu's HTTP API. Not a test of Setu itself: that needs their sandbox.
 *
 *  ✓ Asks for a periodic consent that runs ahead of today, with our credentials
 *  ✓ Reads consent states, and the deposit accounts an active one covers
 *  ✓ Waits for a data session, reads one account's lines in date order, in exact paise
 *  ✓ One session serves every account on a consent; a failed session or API error says why
 *  ✓ Selected by config, and refuses to start half-configured rather than fall back to the mock
 *  ✓ Rupees to paise without floating point; IST dates
 */
import { ConfigService } from '@nestjs/config';
import { SetuAccountAggregator, SetuSettings, istDate, rupeesToPaise } from './setu-aa.provider';
import { MockAccountAggregator } from './mock-aa.provider';
import { bankFeedProvider } from './bank-feeds.module';

const settings: SetuSettings = {
  baseUrl: 'https://fiu-sandbox.setu.example/',
  clientId: 'client',
  clientSecret: 'secret',
  productInstanceId: 'instance',
  purposeCode: '102',
  consentMonths: 12,
  redirectUrl: 'https://app.example/banking',
};

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A stand-in Setu: answers by method and path, and records every call. */
function fakeSetu(routes: Record<string, (body: unknown, n: number) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const http = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const key = `${init.method} ${path}`;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string>, body });
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const route = routes[key];
    const { status = 200, json } = route ? route(body, n) : { status: 404, json: { errorMsg: 'no route' } };
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { http, calls };
}

const session = (status: string) => ({
  id: 'sess-1',
  status,
  fips: [
    {
      fipID: 'HDFC-FIP',
      accounts: [
        {
          linkRefNumber: 'link-1',
          maskedAccNumber: 'XXXXXX1234',
          FIstatus: 'READY',
          data: {
            account: {
              transactions: {
                transaction: [
                  // Newest first, as some banks send them.
                  { txnId: 'T3', type: 'DEBIT', amount: '1,250.50', currentBalance: '98749.50', transactionTimestamp: '2026-10-02T23:30:00+05:30', narration: ' UPI/DR/AIRTEL ', reference: 'R3' },
                  { txnId: 'T2', type: 'CREDIT', amount: '0.07', currentBalance: '100000.00', transactionTimestamp: '2026-10-01T10:00:00+05:30', narration: 'INT CR' },
                  { txnId: 'T1', type: 'DEBIT', amount: '500', currentBalance: '99999.93', transactionTimestamp: '2026-09-30T09:00:00+05:30', narration: 'before the window' },
                  { txnId: '', type: 'CREDIT', amount: 25000, currentBalance: '123749.50', transactionTimestamp: '2026-10-03T11:00:00+05:30', narration: 'NEFT CR RAO TRADERS' },
                ],
              },
            },
          },
        },
        { linkRefNumber: 'link-2', maskedAccNumber: 'XXXXXX9876', FIstatus: 'READY', data: { account: { transactions: { transaction: [] } } } },
      ],
    },
  ],
});

describe('Setu Account Aggregator', () => {
  it('asks for a periodic consent that runs ahead of today, with our credentials', async () => {
    const setu = fakeSetu({ 'POST /v2/consents': () => ({ json: { id: 'consent-1', url: 'https://setu.example/consent/consent-1', status: 'PENDING' } }) });
    const aa = new SetuAccountAggregator(settings, { http: setu.http });
    expect(await aa.createConsent({ customerVua: '9876543210@onemoney', fromDate: '2026-04-01', toDate: '2026-11-04' })).toEqual({
      consentHandle: 'consent-1',
      redirectUrl: 'https://setu.example/consent/consent-1',
    });
    const [call] = setu.calls;
    expect(call.url).toBe('https://fiu-sandbox.setu.example/v2/consents');
    expect(call.headers).toMatchObject({ 'x-client-id': 'client', 'x-client-secret': 'secret', 'x-product-instance-id': 'instance' });
    expect(call.body).toMatchObject({
      vua: '9876543210@onemoney',
      fetchType: 'PERIODIC',
      fiTypes: ['DEPOSIT'],
      purpose: { code: '102' },
      redirectUrl: 'https://app.example/banking',
      // From the start of 1 April IST, to twelve months past today.
      dataRange: { from: '2026-03-31T18:30:00.000Z', to: '2027-11-04T18:29:59.999Z' },
    });
  });

  it('reads consent states, and the deposit accounts an active one covers', async () => {
    let status = 'PENDING';
    const setu = fakeSetu({
      'GET /v2/consents/consent-1': () => ({
        json: {
          id: 'consent-1',
          status,
          accountsLinked: [
            { linkRefNumber: 'link-1', maskedAccNumber: 'XXXXXX1234', fipId: 'HDFC-FIP', fiType: 'DEPOSIT' },
            { linkRefNumber: 'link-9', maskedAccNumber: 'XXXXXX5555', fipId: 'SBI-FIP', fiType: 'MUTUAL_FUNDS' },
          ],
        },
      }),
    });
    const aa = new SetuAccountAggregator(settings, { http: setu.http });
    expect(await aa.consentStatus('consent-1')).toEqual({ status: 'PENDING', accounts: [] });
    status = 'PAUSED';
    expect((await aa.consentStatus('consent-1')).status).toBe('PENDING');
    status = 'ACTIVE';
    expect(await aa.consentStatus('consent-1')).toEqual({
      status: 'ACTIVE',
      accounts: [{ linkRef: 'link-1', maskedAccountNumber: 'XXXXXX1234', fipName: 'HDFC-FIP' }],
    });
    for (const s of ['REJECTED', 'REVOKED', 'EXPIRED']) {
      status = s;
      expect((await aa.consentStatus('consent-1')).status).toBe(s);
    }
  });

  it('waits for the data, and reads one account in date order, in exact paise', async () => {
    const setu = fakeSetu({
      'POST /v2/sessions': () => ({ json: { id: 'sess-1', status: 'PENDING' } }),
      'GET /v2/sessions/sess-1': (_b, n) => ({ json: n < 3 ? { id: 'sess-1', status: 'PENDING' } : session('COMPLETED') }),
    });
    const aa = new SetuAccountAggregator(settings, { http: setu.http, pollIntervalMs: 1 });
    const feed = await aa.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-1', fromDate: '2026-10-01', toDate: '2026-11-04' });
    expect(setu.calls.find((c) => c.method === 'POST')?.body).toEqual({
      consentId: 'consent-1',
      dataRange: { from: '2026-09-30T18:30:00.000Z', to: '2026-11-04T18:29:59.999Z' },
      format: 'json',
    });
    expect(feed.transactions.map((t) => [t.txnId.startsWith('h:') ? 'hashed' : t.txnId, t.date, t.type, t.amountPaise, t.balancePaise])).toEqual([
      ['T2', '2026-10-01', 'CREDIT', 7, 10000000],
      // 23:30 IST on the 2nd is the 2nd.
      ['T3', '2026-10-02', 'DEBIT', 125050, 9874950],
      ['hashed', '2026-10-03', 'CREDIT', 2500000, 12374950],
    ]);
    expect(feed.transactions[1]).toMatchObject({ narration: 'UPI/DR/AIRTEL', reference: 'R3' });
    expect(feed.transactions[0].reference).toBeNull();
    for (const t of feed.transactions) expect(Number.isInteger(t.amountPaise)).toBe(true);

    // The id made for a line without one is the same on the next pull.
    const again = new SetuAccountAggregator(settings, { http: setu.http, pollIntervalMs: 1 });
    const second = await again.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-1', fromDate: '2026-10-01', toDate: '2026-11-04' });
    expect(second.transactions[2].txnId).toBe(feed.transactions[2].txnId);
  });

  it('reads the next account on the same consent from the same session', async () => {
    const setu = fakeSetu({
      'POST /v2/sessions': () => ({ json: { id: 'sess-1' } }),
      'GET /v2/sessions/sess-1': () => ({ json: session('PARTIAL') }),
    });
    const aa = new SetuAccountAggregator(settings, { http: setu.http, pollIntervalMs: 1 });
    await aa.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-1', fromDate: '2026-10-01', toDate: '2026-11-04' });
    expect((await aa.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-2', fromDate: '2026-10-05', toDate: '2026-11-04' })).transactions).toEqual([]);
    expect(setu.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    // An earlier start than the session covers needs a new one.
    await aa.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-2', fromDate: '2026-09-01', toDate: '2026-11-04' });
    expect(setu.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    await expect(aa.fetchTransactions({ consentHandle: 'consent-1', linkRef: 'link-404', fromDate: '2026-10-01', toDate: '2026-11-04' })).rejects.toThrow(/no data for this account/);
  });

  it('says why when the data does not come, or Setu refuses', async () => {
    const failed = fakeSetu({ 'POST /v2/sessions': () => ({ json: { id: 'sess-1' } }), 'GET /v2/sessions/sess-1': () => ({ json: { id: 'sess-1', status: 'FAILED' } }) });
    await expect(new SetuAccountAggregator(settings, { http: failed.http, pollIntervalMs: 1 }).fetchTransactions({ consentHandle: 'c', linkRef: 'l', fromDate: '2026-10-01', toDate: '2026-10-02' })).rejects.toThrow(/did not arrive \(session failed\)/);

    const slow = fakeSetu({ 'POST /v2/sessions': () => ({ json: { id: 'sess-1' } }), 'GET /v2/sessions/sess-1': () => ({ json: { status: 'PENDING' } }) });
    await expect(new SetuAccountAggregator(settings, { http: slow.http, pollIntervalMs: 1, maxPolls: 3 }).fetchTransactions({ consentHandle: 'c', linkRef: 'l', fromDate: '2026-10-01', toDate: '2026-10-02' })).rejects.toThrow(/taking too long/);

    const refused = fakeSetu({ 'POST /v2/consents': () => ({ status: 401, json: { errorMsg: 'Invalid client credentials' } }) });
    await expect(new SetuAccountAggregator(settings, { http: refused.http }).createConsent({ customerVua: 'x@onemoney', fromDate: '2026-04-01', toDate: '2026-11-04' })).rejects.toThrow('Setu POST /v2/consents: HTTP 401 — Invalid client credentials');
  });

  it('revokes', async () => {
    const setu = fakeSetu({ 'POST /v2/consents/consent-1/revoke': () => ({ json: { status: 'REVOKED' } }) });
    await new SetuAccountAggregator(settings, { http: setu.http }).revoke('consent-1');
    expect(setu.calls).toHaveLength(1);
  });
});

describe('choosing the aggregator', () => {
  const config = (bankFeeds: unknown) => new ConfigService({ bankFeeds, urls: { web: 'https://app.example' } });

  it('is the mock unless told otherwise, and Setu when configured', () => {
    expect(bankFeedProvider(config(undefined))).toBeInstanceOf(MockAccountAggregator);
    expect(bankFeedProvider(config({ provider: 'mock' }))).toBeInstanceOf(MockAccountAggregator);
    const setu = bankFeedProvider(config({ provider: 'setu', setu: { ...settings, redirectUrl: '' } }));
    expect(setu).toBeInstanceOf(SetuAccountAggregator);
    expect(setu.isMock).toBe(false);
  });

  it('will not start half-configured, rather than quietly use made-up bank data', () => {
    expect(() => bankFeedProvider(config({ provider: 'setu', setu: { ...settings, clientSecret: '' } }))).toThrow(/missing: clientSecret/);
    expect(() => bankFeedProvider(config({ provider: 'finvu' }))).toThrow(/not one we know/);
    expect(() => bankFeedProvider(config({ provider: 'setu', setu: { ...settings, consentMonths: NaN } }))).toThrow(/whole number of months/);
  });
});

describe('amounts and dates', () => {
  it('turns rupees into paise exactly', () => {
    expect(rupeesToPaise('1,234.56')).toBe(123456);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('12.5')).toBe(1250);
    expect(rupeesToPaise('12.300')).toBe(1230);
    expect(rupeesToPaise('₹ 500')).toBe(50000);
    expect(rupeesToPaise('-19.99')).toBe(-1999);
    expect(rupeesToPaise(1234.5)).toBe(123450);
    // 0.1 + 0.2 in floating point is not 0.30; it is refused, not rounded.
    expect(() => rupeesToPaise(0.1 + 0.2)).toThrow();
    expect(() => rupeesToPaise('12.345')).toThrow();
    expect(() => rupeesToPaise('')).toThrow();
    expect(() => rupeesToPaise('12 rupees')).toThrow();
  });

  it('dates a timestamp by the IST calendar', () => {
    expect(istDate('2026-10-02T23:30:00+05:30')).toBe('2026-10-02');
    expect(istDate('2026-10-02T19:00:00Z')).toBe('2026-10-03');
    expect(istDate('not a date')).toBeNull();
  });
});
