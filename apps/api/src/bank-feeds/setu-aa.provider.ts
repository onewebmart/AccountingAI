import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankFeedProvider, ConsentStatus, FeedAccount, FeedStatement, FeedTransaction } from './provider';

/**
 * Setu's Account Aggregator gateway, from the FIU side (their v2 API).
 *
 * Setu is the licensed party in the middle: it talks to the customer's AA,
 * handles the framework's encryption and key exchange, and hands back the
 * bank's data decrypted, as JSON. So this adapter is plain HTTP: ask for a
 * consent, read its status, open a data session and wait for it, revoke.
 *
 * Written to Setu's published v2 shapes. Check it against their sandbox with
 * your own credentials before you rely on it: field names and the consent
 * template your FIU is approved for are theirs to set, not ours.
 */

export interface SetuSettings {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  productInstanceId: string;
  /** ReBIT purpose code; must match a consent template approved for your FIU. */
  purposeCode: string;
  /** How long a consent lasts, and how far ahead its data range runs. */
  consentMonths: number;
  /** Where the customer lands after the consent screen. */
  redirectUrl: string;
}

export interface SetuOptions {
  /** Injected in tests; the global fetch otherwise. */
  http?: typeof fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
  /** How long one data session serves further accounts on the same consent. */
  sessionReuseMs?: number;
}

/** ReBIT's purpose texts, sent with the code as the framework requires. */
const PURPOSES: Record<string, string> = {
  '101': 'Wealth management service',
  '102': 'Customer spending patterns, budget or other reportings',
  '103': 'Aggregated statement',
  '104': 'Explicit consent for monitoring of the accounts',
  '105': 'Explicit one-time consent for accessing data from the accounts',
};

interface SetuConsent {
  id?: string;
  url?: string;
  status?: string;
  accountsLinked?: Array<{ linkRefNumber?: string; maskedAccNumber?: string; fipId?: string; fipName?: string; fiType?: string }>;
}

interface SetuTxn {
  txnId?: string;
  type?: string;
  amount?: string | number;
  currentBalance?: string | number;
  transactionTimestamp?: string;
  valueDate?: string;
  narration?: string;
  reference?: string;
}

interface SetuSession {
  id?: string;
  status?: string;
  fips?: Array<{
    fipID?: string;
    accounts?: Array<{
      linkRefNumber?: string;
      maskedAccNumber?: string;
      FIstatus?: string;
      data?: { account?: { transactions?: { transaction?: SetuTxn[] } } };
    }>;
  }>;
}

/**
 * Rupees as the bank writes them ("1,234.50", "0.07", 1234.5) into integer
 * paise, exactly: no floating point. More than two decimals is refused
 * rather than rounded, since money must not change on the way in.
 */
export function rupeesToPaise(value: string | number): number {
  const raw = String(value).replace(/[,\s₹]/g, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2})0*)?$/.exec(raw);
  if (!m) throw new Error(`Not an amount in rupees: "${value}"`);
  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error(`Amount out of range: "${value}"`);
  return m[1] ? -paise : paise;
}

/** The IST calendar date of a timestamp: a 23:30 IST payment is that day's, not the next. */
export function istDate(timestamp: string): string | null {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return null;
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();
const istEnd = (date: string) => new Date(`${date}T23:59:59.999+05:30`).toISOString();

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Setu's consent states, in ours. A paused consent waits on the customer, like a pending one. */
function consentStatusOf(status: string | undefined): ConsentStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'REJECTED':
      return 'REJECTED';
    case 'REVOKED':
      return 'REVOKED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

export class SetuAccountAggregator implements BankFeedProvider {
  readonly name = 'setu';
  readonly isMock = false;
  private readonly logger = new Logger(SetuAccountAggregator.name);
  private readonly http: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sessionReuseMs: number;
  /**
   * One session brings every account a consent covers, and consents limit
   * how often data may be fetched. So the session is kept a few minutes and
   * the next account on the same consent is read from it.
   */
  private readonly sessions = new Map<string, { from: string; to: string; at: number; session: SetuSession }>();

  constructor(
    private readonly settings: SetuSettings,
    options: SetuOptions = {},
  ) {
    this.http = options.http ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPolls = options.maxPolls ?? 30;
    this.sessionReuseMs = options.sessionReuseMs ?? 10 * 60_000;
  }

  async createConsent(input: { customerVua: string; fromDate: string; toDate: string }) {
    const months = this.settings.consentMonths;
    const consent = await this.call<SetuConsent>('POST', '/v2/consents', {
      vua: input.customerVua,
      consentDuration: { unit: 'MONTH', value: String(months) },
      // Runs ahead of today, so the daily pull keeps working under this consent.
      dataRange: { from: istStart(input.fromDate), to: istEnd(addMonths(input.toDate, months)) },
      consentMode: 'STORE',
      fetchType: 'PERIODIC',
      consentTypes: ['TRANSACTIONS', 'PROFILE', 'SUMMARY'],
      fiTypes: ['DEPOSIT'],
      // The daily pull, plus someone pressing Sync now a few times.
      frequency: { unit: 'DAY', value: 4 },
      dataLife: { unit: 'MONTH', value: months },
      purpose: {
        code: this.settings.purposeCode,
        refUri: `https://api.rebit.org.in/aa/purpose/${this.settings.purposeCode}.xml`,
        text: PURPOSES[this.settings.purposeCode] ?? 'Accounting and bank reconciliation',
        category: { type: 'string' },
      },
      redirectUrl: this.settings.redirectUrl,
    });
    if (!consent.id || !consent.url) throw new Error('Setu did not return a consent id and URL.');
    return { consentHandle: consent.id, redirectUrl: consent.url };
  }

  async consentStatus(consentHandle: string) {
    const consent = await this.call<SetuConsent>('GET', `/v2/consents/${encodeURIComponent(consentHandle)}?expanded=true`);
    const status = consentStatusOf(consent.status);
    const accounts: FeedAccount[] =
      status === 'ACTIVE'
        ? (consent.accountsLinked ?? [])
            .filter((a) => a.linkRefNumber && a.maskedAccNumber && (!a.fiType || a.fiType === 'DEPOSIT'))
            .map((a) => ({ linkRef: a.linkRefNumber!, maskedAccountNumber: a.maskedAccNumber!, fipName: a.fipName ?? a.fipId ?? 'Bank' }))
        : [];
    return { status, accounts };
  }

  async fetchTransactions(input: { consentHandle: string; linkRef: string; fromDate: string; toDate: string }): Promise<FeedStatement> {
    const session = await this.sessionFor(input.consentHandle, input.fromDate, input.toDate);
    const account = (session.fips ?? []).flatMap((f) => f.accounts ?? []).find((a) => a.linkRefNumber === input.linkRef);
    if (!account) throw new Error('The bank sent no data for this account in this session.');
    const fiStatus = (account.FIstatus ?? 'READY').toUpperCase();
    if (fiStatus !== 'READY' && fiStatus !== 'DELIVERED') throw new Error(`The bank has not sent this account's data (${fiStatus.toLowerCase()}).`);

    const raw = account.data?.account?.transactions?.transaction ?? [];
    const lines = raw
      .map((t, i) => ({ t, i, at: Date.parse(t.transactionTimestamp ?? t.valueDate ?? '') }))
      // Banks send newest first or oldest first; reconciliation reads balances in order.
      .sort((a, b) => (a.at - b.at) || (a.i - b.i))
      .map(({ t }) => this.transaction(t))
      .filter((t) => t.date >= input.fromDate && t.date <= input.toDate);
    return { openingBalancePaise: null, closingBalancePaise: null, transactions: lines };
  }

  async revoke(consentHandle: string): Promise<void> {
    await this.call('POST', `/v2/consents/${encodeURIComponent(consentHandle)}/revoke`);
    this.sessions.delete(consentHandle);
  }

  private transaction(t: SetuTxn): FeedTransaction {
    const type = (t.type ?? '').toUpperCase();
    if (type !== 'DEBIT' && type !== 'CREDIT') throw new Error(`A transaction is neither debit nor credit: "${t.type}"`);
    const date = istDate(t.transactionTimestamp ?? '') ?? (t.valueDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`A transaction has no date: ${t.txnId ?? '(no id)'}`);
    const amountPaise = Math.abs(rupeesToPaise(t.amount ?? ''));
    const balancePaise = t.currentBalance === undefined || t.currentBalance === '' ? null : rupeesToPaise(t.currentBalance);
    const narration = (t.narration ?? '').trim();
    // Some banks leave the id empty; one made from the line itself is stable across pulls.
    const txnId =
      t.txnId?.trim() ||
      `h:${createHash('sha256').update(`${t.transactionTimestamp}|${type}|${amountPaise}|${balancePaise}|${narration}`).digest('hex').slice(0, 24)}`;
    return { txnId, date, narration, reference: t.reference?.trim() || null, type, amountPaise, balancePaise };
  }

  private async sessionFor(consentHandle: string, fromDate: string, toDate: string): Promise<SetuSession> {
    const cached = this.sessions.get(consentHandle);
    if (cached && cached.to === toDate && cached.from <= fromDate && Date.now() - cached.at < this.sessionReuseMs) return cached.session;

    const created = await this.call<SetuSession>('POST', '/v2/sessions', {
      consentId: consentHandle,
      dataRange: { from: istStart(fromDate), to: istEnd(toDate) },
      format: 'json',
    });
    if (!created.id) throw new Error('Setu did not return a data session id.');

    for (let n = 0; n < this.maxPolls; n++) {
      const session = await this.call<SetuSession>('GET', `/v2/sessions/${encodeURIComponent(created.id)}`);
      const status = (session.status ?? '').toUpperCase();
      if (status === 'COMPLETED' || status === 'PARTIAL') {
        if (status === 'PARTIAL') this.logger.warn(`Setu session ${created.id}: only some accounts sent data`);
        this.sessions.set(consentHandle, { from: fromDate, to: toDate, at: Date.now(), session });
        return session;
      }
      if (status === 'FAILED' || status === 'EXPIRED') throw new Error(`The bank's data did not arrive (session ${status.toLowerCase()}).`);
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error('The bank is taking too long to send data. The next pull will try again.');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.settings.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': this.settings.clientId,
        'x-client-secret': this.settings.clientSecret,
        'x-product-instance-id': this.settings.productInstanceId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the status line says enough.
    }
    if (!res.ok) {
      const detail = (json as { errorMsg?: string; message?: string; error?: { message?: string } } | null) ?? null;
      const why = detail?.errorMsg ?? detail?.message ?? detail?.error?.message ?? text.slice(0, 200);
      throw new Error(`Setu ${method} ${path.split('?')[0]}: HTTP ${res.status}${why ? ` — ${why}` : ''}`);
    }
    return json as T;
  }
}
