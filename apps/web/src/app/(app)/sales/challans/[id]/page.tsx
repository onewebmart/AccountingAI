'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, Section, DetailGrid } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { CHALLAN_REASON, errorText, openPdf, shortDate, useChallan } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';
import { DocLinesTable, NotesAndTerms, wordRows } from '@/components/sales/doc-view';

/** One delivery challan: what left, why, and whether it came back. */
export default function ChallanPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const challan = useChallan(id);
  const status = useMutation({
    mutationFn: (action: 'return' | 'cancel') => api.post(`/orders/challans/${id}/${action}`),
    onSuccess: (_r, action) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      notify(action === 'return' ? 'Marked returned' : 'Challan cancelled', action === 'return' ? 'success' : 'info');
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  if (challan.isError) return <QueryError error={challan.error} onRetry={() => void challan.refetch()} />;
  if (challan.isLoading) return <p className="text-caption text-ink-400">Loading…</p>;
  const c = challan.data;
  if (!c) {
    return (
      <div>
        <PageHeader title="Challan not found" back={{ href: '/sales/challans', label: 'Delivery challans' }} />
        <p className="text-body text-ink-500">There is no such challan in this organisation.</p>
      </div>
    );
  }
  const issued = c.status === 'issued';

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Delivery challan <span className="font-mono">{c.number}</span></>}
        meta={<DocStatusChip status={c.status} />}
        subtitle={<><Link href={`/sales/customers/${c.customerId}`} className="hover:underline">{c.customerName}</Link> · {CHALLAN_REASON[c.reason]}</>}
        back={{ href: '/sales/challans', label: 'Delivery challans' }}
        actions={
          <>
            <Button variant="secondary" onClick={() => void openPdf(`/orders/challans/${id}/pdf`).catch((e: Error) => notify(e.message, 'error'))}>
              <FileText size={14} /> PDF
            </Button>
            {issued && (
              <Button variant="ghost" disabled={status.isPending} onClick={() => window.confirm(`Cancel challan ${c.number}?`) && status.mutate('cancel')}>
                Cancel challan
              </Button>
            )}
            {issued && c.reason !== 'supply' && (
              <Button disabled={status.isPending} onClick={() => status.mutate('return')}>Returned</Button>
            )}
          </>
        }
      />

      <Section title="Details">
        <DetailGrid
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${c.customerId}`} className="hover:underline">{c.customerName}</Link>],
            ['Date', shortDate(c.date)],
            ['Challan type', CHALLAN_REASON[c.reason] ?? c.reason],
            ['Vehicle', c.vehicleNo ? <span key="v" className="font-mono">{c.vehicleNo}</span> : '—'],
            ['Against order', c.salesOrderId ? <Link key="o" href={`/sales/orders/${c.salesOrderId}`} className="hover:underline">Open the order</Link> : '—'],
            ...wordRows(c),
          ]}
        />
      </Section>

      <Section title="Goods">
        <DocLinesTable lines={c.lines.map((l) => l.line)} />
      </Section>

      <NotesAndTerms notes={c.notes} terms={c.termsAndConditions} />

      <Link href={`/audit?entityType=DeliveryChallan&entityId=${id}`} className="inline-block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
        History of this challan
      </Link>
    </div>
  );
}
