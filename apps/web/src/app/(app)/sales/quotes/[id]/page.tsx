'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, Section, DetailGrid } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, openPdf, shortDate, useQuotes } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';
import { AmountsList, DocLinesTable } from '@/components/sales/doc-view';

type Action = 'send' | 'accept' | 'decline' | 'convert/sales_order' | 'convert/invoice';

/** One quote: its lines, and sending, the customer's answer, and what it becomes. */
export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const quotes = useQuotes();

  const act = useMutation({
    mutationFn: (action: Action) => api.post<{ emailed?: boolean; kind?: 'sales_order' | 'invoice'; id?: string }>(`/orders/quotes/${id}/${action}`, {}),
    onSuccess: (r, action) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (action === 'send') notify(r.emailed ? 'Quote sent' : 'Marked sent: no email was sent, as there is no address or mail server', r.emailed ? 'success' : 'info');
      else if (action === 'accept') notify('Quote accepted');
      else if (action === 'decline') notify('Quote declined', 'info');
      else if (r.kind === 'invoice' && r.id) {
        void queryClient.invalidateQueries({ queryKey: ['sales'] });
        notify('Draft invoice made: check it, then post it');
        router.push(`/sales/invoices/${r.id}`);
      } else if (r.kind === 'sales_order' && r.id) {
        notify('Sales order made');
        router.push(`/sales/orders/${r.id}`);
      }
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  if (quotes.isError) return <QueryError error={quotes.error} onRetry={() => void quotes.refetch()} />;
  if (quotes.isLoading) return <p className="text-caption text-ink-400">Loading…</p>;
  const q = (quotes.data ?? []).find((x) => x._id === id);
  if (!q) {
    return (
      <div>
        <PageHeader title="Quote not found" back={{ href: '/sales/quotes', label: 'Quotes' }} />
        <p className="text-body text-ink-500">It may belong to another organisation, or be older than the latest 300 quotes.</p>
      </div>
    );
  }
  const answerable = q.status === 'draft' || q.status === 'sent';
  const convertible = q.status === 'accepted';

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Quote <span className="font-mono">{q.number}</span></>}
        meta={<DocStatusChip status={q.expired ? 'expired' : q.status} />}
        subtitle={<><Link href={`/sales/customers/${q.customerId}`} className="hover:underline">{q.customerName}</Link> · <span className="font-mono">{formatPaise(q.amountsPaise.total)}</span></>}
        back={{ href: '/sales/quotes', label: 'Quotes' }}
        actions={
          <>
            <Button variant="secondary" onClick={() => void openPdf(`/orders/quotes/${id}/pdf`).catch((e: Error) => notify(e.message, 'error'))}>
              <FileText size={14} /> PDF
            </Button>
            {answerable && <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('decline')}>Declined</Button>}
            {answerable && <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('accept')}>Accepted</Button>}
            {answerable && <Button disabled={act.isPending} onClick={() => act.mutate('send')}>{q.status === 'sent' ? 'Send quote again' : 'Send quote'}</Button>}
            {convertible && <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('convert/invoice')}>Make invoice</Button>}
            {convertible && <Button disabled={act.isPending} onClick={() => act.mutate('convert/sales_order')}>Make order</Button>}
          </>
        }
      />

      {q.drafted && (
        <div className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          <p className="font-medium">Drafted from the customer&apos;s message{q.drafted.source === 'model' ? ' by AI' : ''}: check every line before you send it.</p>
          {q.drafted.unread.length > 0 && <p className="text-caption">Not read: {q.drafted.unread.join(', ')}</p>}
          {q.drafted.message && <p className="mt-1 whitespace-pre-line text-caption text-ink-700">“{q.drafted.message}”</p>}
        </div>
      )}

      {q.convertedTo && (
        <p className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-2 text-body text-success-fg">
          Became{' '}
          {q.convertedTo.kind === 'invoice' ? (
            <Link className="underline" href={`/sales/invoices/${q.convertedTo.id}`}>a draft invoice</Link>
          ) : (
            <Link className="underline" href={`/sales/orders/${q.convertedTo.id}`}>a sales order</Link>
          )}
          .
        </p>
      )}

      <Section title="Details">
        <DetailGrid
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${q.customerId}`} className="hover:underline">{q.customerName}</Link>],
            ['Date', shortDate(q.date)],
            ['Valid until', <span key="v" className={q.expired ? 'text-error-fg' : undefined}>{shortDate(q.validUntil)}{q.expired ? ' (expired)' : ''}</span>],
            ['Sent to', q.sentTo ?? '—'],
          ]}
        />
      </Section>

      <Section title="Lines">
        <DocLinesTable lines={q.lines} />
        <div className="mt-4">
          <AmountsList amounts={q.amountsPaise} />
        </div>
      </Section>

      {q.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line text-body text-ink-700">{q.notes}</p>
        </Section>
      )}

      <Link href={`/audit?entityType=Quote&entityId=${id}`} className="inline-block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
        History of this quote
      </Link>
    </div>
  );
}
