'use client';

import Link from 'next/link';
import { StatusChip } from '@/components/page/page-shell';
import type { InvoiceStatus } from './sales-data';

/** Amber waits (a draft sent but not posted), green is in the books. */
export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  const [tone, label] = ({
    draft: ['neutral', 'Draft'],
    sent: ['pending', 'Sent'],
    posted: ['success', 'Posted'],
    paid: ['success', 'Paid'],
  } as const)[status] ?? (['neutral', status] as const);
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

const DOC: Record<string, ['pending' | 'success' | 'neutral', string]> = {
  draft: ['neutral', 'Draft'],
  sent: ['pending', 'Sent'],
  accepted: ['success', 'Accepted'],
  declined: ['neutral', 'Declined'],
  converted: ['success', 'Converted'],
  expired: ['neutral', 'Expired'],
  open: ['pending', 'Open'],
  closed: ['success', 'Closed'],
  cancelled: ['neutral', 'Cancelled'],
  issued: ['pending', 'Issued'],
  returned: ['neutral', 'Returned'],
};

/** Quotes, sales orders and challans. */
export function DocStatusChip({ status }: { status: string }) {
  const [tone, label] = DOC[status] ?? ['neutral', status];
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/**
 * Where an invoice came from: typed in, read off an upload, or drafted by a
 * recurring schedule. When a figure looks wrong, that is the first question.
 */
export function SourceChip({ documentId, recurring }: { documentId?: string | null; recurring?: boolean }) {
  if (recurring) {
    return (
      <Link href="/sales/recurring-invoices" title="Drafted from a recurring schedule" className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-medium text-info-fg hover:underline" onClick={(e) => e.stopPropagation()}>
        Recurring
      </Link>
    );
  }
  if (!documentId) {
    return (
      <span title="Entered by hand" className="rounded bg-surface-sink px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
        Manual
      </span>
    );
  }
  return (
    <Link href="/inbox" title="Read from an uploaded document — open the Inbox" className="rounded bg-honey-100 px-1.5 py-0.5 text-[10px] font-medium text-pending-fg hover:underline" onClick={(e) => e.stopPropagation()}>
      Scanned
    </Link>
  );
}
