/**
 * The seam between bank feeds and whoever supplies them.
 *
 * In India that is the Account Aggregator framework: the business (the FIU,
 * through us) asks for consent, the customer approves it in their AA app,
 * and the bank (the FIP) sends the account data through the aggregator.
 * A real adapter (Setu, Finvu, OneMoney, or another licensed AA) also handles
 * the encryption the framework requires; business logic sees only this.
 */

export const BANK_FEED_PROVIDER = Symbol('BANK_FEED_PROVIDER');

export type ConsentStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface FeedAccount {
  /** The aggregator's reference for the linked account. */
  linkRef: string;
  maskedAccountNumber: string;
  /** The bank, as the aggregator names it. */
  fipName: string;
}

export interface FeedTransaction {
  /** The bank's id for the transaction; stable across pulls. */
  txnId: string;
  /** YYYY-MM-DD */
  date: string;
  narration: string;
  reference: string | null;
  type: 'DEBIT' | 'CREDIT';
  amountPaise: number;
  /** Balance after the transaction, when the bank sends it. */
  balancePaise: number | null;
}

export interface FeedStatement {
  openingBalancePaise: number | null;
  closingBalancePaise: number | null;
  transactions: FeedTransaction[];
}

export interface BankFeedProvider {
  readonly name: string;
  /** True while no real aggregator is connected. */
  readonly isMock: boolean;

  /** Ask for consent; the customer approves it at the returned URL, in their AA app. */
  createConsent(input: { customerVua: string; fromDate: string; toDate: string }): Promise<{ consentHandle: string; redirectUrl: string }>;

  consentStatus(consentHandle: string): Promise<{ status: ConsentStatus; accounts: FeedAccount[] }>;

  fetchTransactions(input: { consentHandle: string; linkRef: string; fromDate: string; toDate: string }): Promise<FeedStatement>;

  revoke(consentHandle: string): Promise<void>;
}
