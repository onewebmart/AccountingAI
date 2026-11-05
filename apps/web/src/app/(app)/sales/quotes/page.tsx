'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, Section, Field, inputClass, th, td, tdMoney, rowLink } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, shortDate, useCustomers, useQuotes, type QuoteRow } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';

interface FollowUp { quoteId: string; number: string; customerName: string; sentOn: string | null; totalPaise: number; message: string }

/**
 * A customer's email or WhatsApp, read into a draft quote at their last
 * prices. The rules read it; when they cannot, the AI tries in the
 * background. Either way it is only a draft for a person to check and send.
 */
function DraftFromMessage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState('');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const opened = useCallback(
    (quoteId: string, message: string) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      notify(message);
      router.push(`/sales/quotes/${quoteId}`);
    },
    [queryClient, router],
  );
  const draft = useMutation({
    mutationFn: () => api.post<{ status: 'done' | 'queued'; suggestionId: string | null; quote: { _id: string } | null }>('/orders/quotes/from-message', { customerId, text }),
    onSuccess: (r) => {
      if (r.status === 'queued') setPending(r.suggestionId);
      else if (r.quote) opened(r.quote._id, 'Draft quote made: check it, then send it');
    },
  });
  const poll = useQuery({
    queryKey: ['orders', 'drafting', pending],
    queryFn: () => api.get<{ status: string; quoteId: string | null; message: string | null }>(`/orders/quotes/drafting/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') {
      setPending(null);
      if (poll.data.status === 'done' && poll.data.quoteId) opened(poll.data.quoteId, 'Draft quote made by AI: check every line');
    }
  }, [poll.data, opened]);

  return (
    <Section
      title="Draft from a message"
      description="Paste the customer's email or WhatsApp. Quantities and your items are read from it, at this customer's last prices; you check it and send it."
    >
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <Field label="Customer">
          <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Which customer?</option>
            {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Their message">
          <textarea className={inputClass} rows={3} placeholder="Please send 200 cartons of A4 paper and 10 boxes of staples by Friday" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!customerId || !text.trim() || draft.isPending || !!pending} onClick={() => draft.mutate()}>
          {draft.isPending || pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-marigold-400" />} Draft quote
        </Button>
        {pending && <span className="text-caption text-pending-fg">The AI is reading it…</span>}
        {draft.isError && <span className="text-caption text-error-fg">{errorText(draft.error)}</span>}
        {poll.data?.status === 'none' && <span className="text-caption text-ink-500">{poll.data.message}</span>}
      </div>
    </Section>
  );
}

const FILTERS: Array<[string, string]> = [['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['converted', 'Converted'], ['expired', 'Expired']];
const shown = (q: QuoteRow) => (q.expired ? 'expired' : q.status);

export default function QuotesPage() {
  const router = useRouter();
  const quotes = useQuotes();
  const followUps = useQuery({ queryKey: ['orders', 'follow-ups'], queryFn: () => api.get<FollowUp[]>('/orders/quotes/follow-ups') });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = quotes.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((x) => filter === 'all' || shown(x) === filter)
    .filter((x) => !q || [x.number, x.customerName].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        guide="quotes"
        title="Quotes"
        subtitle="What you offered. None of it posts: an accepted quote becomes a sales order or a draft invoice."
        actions={<Button asChild><Link href="/sales/quotes/new"><Plus size={14} /> New quote</Link></Button>}
      />

      <DraftFromMessage />

      {(followUps.data ?? []).length > 0 && (
        <Section title="No answer after a week" description="Sent quotes the customer has not answered. Copy the follow-up and send it your way.">
          <ul className="space-y-2">
            {followUps.data!.map((f) => (
              <li key={f.quoteId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-pending-bg px-3 py-2 text-caption text-pending-fg">
                <Link href={`/sales/quotes/${f.quoteId}`} className="hover:underline">
                  {f.customerName} · <span className="font-mono">{f.number}</span> · <span className="font-mono">{formatPaise(f.totalPaise)}</span> · sent {shortDate(f.sentOn)}
                </Link>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                  onClick={() => void navigator.clipboard.writeText(f.message).then(() => notify('Follow-up copied'))}
                >
                  <Copy size={12} /> Copy follow-up
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!quotes.isLoading && !quotes.isError && all.length === 0 ? (
        <EmptyState guide="quotes" title="No quotes yet" body="Make one by hand, or paste a customer's message above." action={<Button asChild><Link href="/sales/quotes/new"><Plus size={14} /> New quote</Link></Button>} />
      ) : (
        <div>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search number or customer" filters={{ value: filter, onChange: setFilter, options: FILTERS }} />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Quote</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Date</th>
                  <th className={th}>Valid until</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {quotes.isLoading ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : quotes.isError ? (
                  <TableError error={quotes.error} colSpan={6} onRetry={() => void quotes.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">No quotes match.</td></tr>
                ) : (
                  rows.map((x) => (
                    <tr key={x._id} className={rowLink} onClick={() => router.push(`/sales/quotes/${x._id}`)}>
                      <td className={td}>
                        <Link href={`/sales/quotes/${x._id}`} className="font-mono text-caption hover:underline" onClick={(e) => e.stopPropagation()}>{x.number}</Link>
                        {x.drafted && (
                          <p className="text-[0.7rem] text-pending-fg">
                            Drafted from a message{x.drafted.source === 'model' ? ' by AI' : ''}{x.drafted.unread.length ? `; not read: ${x.drafted.unread.join(', ')}` : ''}
                          </p>
                        )}
                      </td>
                      <td className={`${td} font-medium`}>{x.customerName}</td>
                      <td className={`${td} text-caption text-ink-600`}>{shortDate(x.date)}</td>
                      <td className={`${td} text-caption text-ink-600`}>{shortDate(x.validUntil)}</td>
                      <td className={td}><DocStatusChip status={shown(x)} /></td>
                      <td className={tdMoney}>{formatPaise(x.amountsPaise.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  );
}
