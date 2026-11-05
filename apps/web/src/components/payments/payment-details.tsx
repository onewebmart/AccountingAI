'use client';

import { AttachmentsSection } from '@/components/shell/attachments-section';
import { formatPaise } from '@/lib/gst';

/** How money moved, as the API stores it, and how it reads. */
export const PAYMENT_MODES: Array<[string, string]> = [
  ['bank_transfer', 'Bank transfer'],
  ['upi', 'UPI'],
  ['cheque', 'Cheque'],
  ['cash', 'Cash'],
  ['card', 'Card'],
  ['other', 'Other'],
];
export const PAYMENT_MODE_LABEL: Record<string, string> = Object.fromEntries(PAYMENT_MODES);

/**
 * What a receipt or payment holds beyond its row in the list: the account,
 * how it moved, what the bank charged, the internal notes, and its files.
 */
export function PaymentDetails({ payment, kind }: {
  payment: { _id: string; amountPaise: number; via: 'bank' | 'cash' | 'gateway'; mode?: string | null; depositAccountName?: string | null; bankChargesPaise?: number; notes?: string | null };
  kind: 'receipt' | 'payment';
}) {
  const charges = payment.bankChargesPaise ?? 0;
  // Recorded before the account was kept: the system account `via` named.
  const accountName = payment.depositAccountName ?? { bank: 'Bank', cash: 'Cash', gateway: 'Payment gateway' }[payment.via];
  const atBank = kind === 'receipt' ? payment.amountPaise - charges : payment.amountPaise + charges;
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
        <dt className="text-ink-500">{kind === 'receipt' ? 'Deposit to' : 'Paid through'}</dt>
        <dd className="text-ink-900">{accountName ?? '—'}</dd>
        <dt className="text-ink-500">Mode</dt>
        <dd className="text-ink-900">{payment.mode ? PAYMENT_MODE_LABEL[payment.mode] ?? payment.mode : '—'}</dd>
        <dt className="text-ink-500">Bank charges</dt>
        <dd className="font-mono text-ink-900">{charges ? formatPaise(charges) : '—'}</dd>
        {charges > 0 && (
          <>
            <dt className="text-ink-500">{kind === 'receipt' ? 'Reached the bank' : 'Left the bank'}</dt>
            <dd className="font-mono text-ink-900">{formatPaise(atBank)}</dd>
          </>
        )}
      </dl>
      <div>
        <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">Notes</p>
        <p className="whitespace-pre-wrap text-caption text-ink-700">{payment.notes || <span className="text-ink-400">None.</span>}</p>
      </div>
      <AttachmentsSection entityType="PartyPayment" entityId={payment._id} />
    </div>
  );
}
