'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, Section, DetailGrid, TableCard, th, td, tdMoney } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, openPdf, shortDate, useOrder, type OrderRow } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';
import { AmountsList } from '@/components/sales/doc-view';

const left = (l: OrderRow['lines'][number]) => Math.max(0, l.qty - (l.invoicedQty ?? 0));

/**
 * Bill part of an order: how much of each line to invoice now. It becomes a
 * draft invoice, priced from the order's lines, for a person to post.
 */
function InvoicePart({ order }: { order: OrderRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [qtys, setQtys] = useState<string[]>(order.lines.map((l) => String(left(l))));
  const picks = qtys.map((q, i) => ({ orderLine: i, qty: Number(q || 0) }));
  const bad = picks.find((p) => !(p.qty >= 0) || p.qty > left(order.lines[p.orderLine]));
  const chosen = picks.filter((p) => p.qty > 0);
  const before = chosen.reduce((s, p) => s + Math.round(p.qty * order.lines[p.orderLine].ratePaise), 0);

  const make = useMutation({
    mutationFn: () => api.post<{ _id: string }>(`/orders/sales-orders/${order._id}/invoice`, { lines: chosen }),
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      notify('Draft invoice made: check it, then post it');
      router.push(`/sales/invoices/${invoice._id}`);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  return (
    <Section
      title="Invoice part of it"
      description="How much of each line to bill now. The rest stays on the order for a later invoice."
      actions={
        <Button size="sm" disabled={!!bad || chosen.length === 0 || make.isPending} onClick={() => make.mutate()}>
          {make.isPending ? 'Making…' : 'Make draft invoice'}
        </Button>
      }
    >
      <TableCard className="border-line-100">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line-200 bg-surface-sink">
              <th className={th}>Line</th>
              <th className={`${th} text-right`}>Left to invoice</th>
              <th className={`${th} w-36 text-right`}>Invoice now</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr key={i} className="border-b border-line-100 last:border-0">
                <td className={td}>{l.description}</td>
                <td className={tdMoney}>{left(l)}</td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    aria-label={`Invoice now: ${l.description}`}
                    className={`w-28 rounded-md border bg-white px-2 py-1 text-right font-mono text-caption ${bad?.orderLine === i ? 'border-error-fg' : 'border-line-200'}`}
                    inputMode="decimal"
                    disabled={left(l) === 0}
                    value={qtys[i] ?? ''}
                    onChange={(e) => setQtys(qtys.map((q, n) => (n === i ? e.target.value : q)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <p className="mt-2 text-caption text-ink-500">
        {bad ? <span className="text-error-fg">Line {bad.orderLine + 1}: only {left(order.lines[bad.orderLine])} left to invoice.</span> : <>Before tax <span className="font-mono text-ink-900">{formatPaise(before)}</span>; the tax is worked out on the invoice.</>}
      </p>
    </Section>
  );
}

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const order = useOrder(id);
  const status = useMutation({
    mutationFn: (action: 'close' | 'cancel') => api.post(`/orders/sales-orders/${id}/${action}`),
    onSuccess: (_r, action) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      notify(action === 'close' ? 'Order closed' : 'Order cancelled', action === 'close' ? 'success' : 'info');
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  if (order.isError) return <QueryError error={order.error} onRetry={() => void order.refetch()} />;
  if (order.isLoading) return <p className="text-caption text-ink-400">Loading…</p>;
  const o = order.data;
  if (!o) {
    return (
      <div>
        <PageHeader title="Sales order not found" back={{ href: '/sales/orders', label: 'Sales orders' }} />
        <p className="text-body text-ink-500">There is no such sales order in this organisation.</p>
      </div>
    );
  }
  const open = o.status === 'open';
  const anyInvoiced = o.lines.some((l) => (l.invoicedQty ?? 0) > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Sales order <span className="font-mono">{o.number}</span></>}
        meta={<DocStatusChip status={o.status} />}
        subtitle={<><Link href={`/sales/customers/${o.customerId}`} className="hover:underline">{o.customerName}</Link> · <span className="font-mono">{formatPaise(o.amountsPaise.total)}</span></>}
        back={{ href: '/sales/orders', label: 'Sales orders' }}
        actions={
          <>
            <Button variant="secondary" onClick={() => void openPdf(`/orders/sales-orders/${id}/pdf`).catch((e: Error) => notify(e.message, 'error'))}>
              <FileText size={14} /> PDF
            </Button>
            {open && !anyInvoiced && (
              <Button
                variant="ghost"
                disabled={status.isPending}
                onClick={() => window.confirm(`Cancel order ${o.number}? It cannot be invoiced after this.`) && status.mutate('cancel')}
              >
                Cancel order
              </Button>
            )}
            {open && (
              <Button variant="secondary" disabled={status.isPending} onClick={() => window.confirm(`Close order ${o.number}? What is not invoiced yet will not be.`) && status.mutate('close')}>
                Close
              </Button>
            )}
          </>
        }
      />

      <Section title="Details">
        <DetailGrid
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${o.customerId}`} className="hover:underline">{o.customerName}</Link>],
            ['Date', shortDate(o.date)],
            ['Expected by', shortDate(o.expectedBy)],
            ["Customer's PO", o.customerPoNumber ? <span key="po" className="font-mono">{o.customerPoNumber}</span> : '—'],
            ['From quote', o.quoteId ? <Link key="q" href={`/sales/quotes/${o.quoteId}`} className="hover:underline">Open the quote</Link> : '—'],
          ]}
        />
      </Section>

      <Section title="Lines" description="Ordered, invoiced so far, and delivered under challans.">
        <TableCard className="border-line-100">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Description</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>GST</th>
                <th className={`${th} text-right`}>Ordered</th>
                <th className={`${th} text-right`}>Invoiced</th>
                <th className={`${th} text-right`}>Delivered</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={td}>{l.description}</td>
                  <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
                  <td className={tdMoney}>{l.taxRatePct}%</td>
                  <td className={tdMoney}>{l.qty}</td>
                  <td className={`${tdMoney} ${(l.invoicedQty ?? 0) >= l.qty ? 'text-success-fg' : ''}`}>{l.invoicedQty ?? 0}</td>
                  <td className={`${tdMoney} ${(l.deliveredQty ?? 0) >= l.qty ? 'text-success-fg' : ''}`}>{l.deliveredQty ?? 0}</td>
                  <td className={tdMoney}>{formatPaise(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
        <div className="mt-4">
          <AmountsList amounts={o.amountsPaise} />
        </div>
      </Section>

      {open && !o.fullyInvoiced && <InvoicePart key={o.lines.map((l) => l.invoicedQty ?? 0).join('-')} order={o} />}
      {o.fullyInvoiced && <p className="text-body text-success-fg">Every line is invoiced.</p>}

      {o.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line text-body text-ink-700">{o.notes}</p>
        </Section>
      )}

      <Link href={`/audit?entityType=SalesOrder&entityId=${id}`} className="inline-block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
        History of this order
      </Link>
    </div>
  );
}
