import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { BankFeedProvider, ConsentStatus, FeedAccount, FeedStatement, FeedTransaction } from './provider';

/** A small seeded random generator, so the mock bank says the same thing every time. */
function seeded(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The mock bank's history starts here. */
const ANCHOR = '2025-04-01';

const MERCHANTS = ['SWIGGY', 'AMAZON PAY', 'AIRTEL', 'INDIAN OIL', 'UBER INDIA', 'BLUE DART'];
const CUSTOMERS = ['ACME CORP', 'RAO TRADERS', 'MEHTA RETAIL'];

/**
 * A stand-in Account Aggregator for development and tests. Consents start
 * PENDING, as a real one does until the customer approves in their AA app;
 * approve() plays that part. Transactions are generated from a fixed start
 * and a seed, so pulling the same dates twice returns the same lines with
 * the same ids and balances.
 */
@Injectable()
export class MockAccountAggregator implements BankFeedProvider {
  readonly name = 'mock';
  readonly isMock = true;

  private consents = new Map<string, { status: ConsentStatus; vua: string; fromDate: string }>();

  async createConsent(input: { customerVua: string; fromDate: string; toDate: string }) {
    const consentHandle = `mock-${randomUUID()}`;
    this.consents.set(consentHandle, { status: 'PENDING', vua: input.customerVua, fromDate: input.fromDate });
    return { consentHandle, redirectUrl: `https://aa.example/consent/${consentHandle}` };
  }

  /** What the customer approving in their AA app would do. */
  approve(consentHandle: string): void {
    const consent = this.consents.get(consentHandle);
    if (!consent) throw new NotFoundException('No such consent at the mock aggregator');
    consent.status = 'ACTIVE';
  }

  async consentStatus(consentHandle: string) {
    const consent = this.consents.get(consentHandle) ?? this.restore(consentHandle);
    const accounts: FeedAccount[] =
      consent.status === 'ACTIVE'
        ? [{ linkRef: `${consentHandle}:1`, maskedAccountNumber: `XXXXXXXX${this.digits(consentHandle)}`, fipName: 'HDFC Bank' }]
        : [];
    return { status: consent.status, accounts };
  }

  async fetchTransactions(input: { consentHandle: string; linkRef: string; fromDate: string; toDate: string }): Promise<FeedStatement> {
    const consent = this.consents.get(input.consentHandle) ?? this.restore(input.consentHandle);
    if (consent.status !== 'ACTIVE') throw new Error(`Consent is ${consent.status}`);
    // Generated from a fixed day, so a date's lines and balances are the same
    // whatever window is asked for, and after a restart.
    const random = seeded(input.linkRef);
    let balance = 50000000 + Math.floor(random() * 10000000);
    const all: FeedTransaction[] = [];
    let openingBalancePaise: number | null = input.fromDate <= ANCHOR ? balance : null;
    for (let date = ANCHOR; date <= input.toDate; date = addDays(date, 1)) {
      if (date === input.fromDate) openingBalancePaise = balance;
      const count = Math.floor(random() * 3);
      for (let n = 0; n < count; n++) {
        const credit = random() < 0.3;
        const amountPaise = credit ? 500000 + Math.floor(random() * 5000000) : 10000 + Math.floor(random() * 500000);
        balance += credit ? amountPaise : -amountPaise;
        const counterparty = credit ? CUSTOMERS[Math.floor(random() * CUSTOMERS.length)] : MERCHANTS[Math.floor(random() * MERCHANTS.length)];
        const rrn = String(400000000000 + Math.floor(random() * 99999999999)).slice(0, 12);
        all.push({
          txnId: `${input.linkRef}:${date}:${n}`,
          date,
          narration: credit ? `NEFT CR-HDFC0000001-${counterparty}-INV` : `UPI/DR/${rrn}/${counterparty}/YESB/x@ybl/UPI`,
          reference: rrn,
          type: credit ? 'CREDIT' : 'DEBIT',
          amountPaise,
          balancePaise: balance,
        });
      }
    }
    const transactions = all.filter((t) => t.date >= input.fromDate && t.date <= input.toDate);
    return { openingBalancePaise: openingBalancePaise ?? balance, closingBalancePaise: balance, transactions };
  }

  async revoke(consentHandle: string): Promise<void> {
    const consent = this.consents.get(consentHandle) ?? this.restore(consentHandle);
    consent.status = 'REVOKED';
  }

  /**
   * The mock keeps consents in memory; after a restart, a handle the
   * database still holds is treated as approved.
   */
  private restore(consentHandle: string) {
    if (!consentHandle.startsWith('mock-')) throw new NotFoundException('No such consent at the mock aggregator');
    const consent = { status: 'ACTIVE' as ConsentStatus, vua: 'restored', fromDate: ANCHOR };
    this.consents.set(consentHandle, consent);
    return consent;
  }

  private digits(handle: string): string {
    return String(createHash('sha256').update(handle).digest().readUInt16LE(0) % 10000).padStart(4, '0');
  }
}
