'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, Section, DetailGrid, TableCard, th, td, tdMoney, rowLink } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, shortDate, stateName, useCustomerInvoices, type CustomerRecord } from '@/components/sales/sales-data';
import { InvoiceStatusChip } from '@/components/sales/status';
import { ContactPersonsList, profileDetailItems, type PartyProfile } from '@/components/parties/party-profile';

/**
 * A link the customer can open to see their invoices and PDFs, and pay
 * where a payment link is open. No login; it expires, and can be withdrawn.
 */
function PortalLink({ customerId, enabled }: { customerId: string; enabled: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const share = useMutation({
    mutationFn: () => api.post<{ url: string; expiresAt: string }>('/portal-links', { customerId, days: 30 }),
    onSuccess: async (res) => {
      setUrl(res.url);
      await navigator.clipboard?.writeText(res.url).catch(() => undefined);
      notify('Portal link copied');
    },
    onError: (e) => notify(errorText(e, "Couldn't make a portal link."), 'error'),
  });
  const withdraw = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/portal-links/revoke', { customerId }),
    onSuccess: (res) => {
      setUrl(null);
      notify(res.revoked ? `Withdrew ${res.revoked} link${res.revoked === 1 ? '' : 's'}` : 'No live links to withdraw', res.revoked ? 'success' : 'info');
    },
    onError: (e) => notify(errorText(e, "Couldn't withdraw the links."), 'error'),
  });
  return (
    <Section
      title="Customer portal"
      description="They see their invoices and PDFs for 30 days, and can pay any with a payment link. No login needed."
      actions={
        <>
          <Button size="sm" variant="secondary" disabled={share.isPending || !enabled} onClick={() => share.mutate()}>
            {share.isPending ? 'Making a link…' : 'Copy portal link'}
          </Button>
          <Button size="sm" variant="ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            Withdraw links
          </Button>
        </>
      }
    >
      {!enabled ? (
        <p className="text-caption text-ink-500">
          Portal access is turned off for this customer, so no link opens. <Link href={`/sales/customers/${customerId}/edit`} className="font-medium text-ink-700 hover:underline">Turn it on in Edit</Link>.
        </p>
      ) : url ? (
        <p className="break-all font-mono text-caption text-ink-600">{url}</p>
      ) : (
        <p className="text-caption text-ink-400">No link made on this visit.</p>
      )}
    </Section>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const customer = useQuery({ queryKey: ['sales', 'customer', id], queryFn: () => api.get<CustomerRecord>(`/sales/customers/${id}`) });
  const owed = useQuery({ queryKey: ['sales', 'customer', id, 'receivable'], queryFn: () => api.get<{ paise: number }>(`/sales/customers/${id}/receivable`) });
  const advances = useQuery({
    queryKey: ['payments', 'advances', 'receipt'],
    queryFn: () => api.get<Array<{ partyId: string; unappliedPaise: number }>>('/payments/advances?kind=receipt'),
  });
  const invoices = useCustomerInvoices(id);

  if (customer.isError) return <QueryError error={customer.error} onRetry={() => void customer.refetch()} />;
  if (!customer.data) return <p className="text-caption text-ink-400">Loading…</p>;
  const c = customer.data as CustomerRecord & PartyProfile;
  const theirs = invoices.data ?? [];
  const held = (advances.data ?? []).find((a) => a.partyId === id)?.unappliedPaise ?? 0;
  const overdue = theirs.filter((i) => i.outstandingPaise > 0 && i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10)).reduce((s, i) => s + i.outstandingPaise, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        subtitle={c.gstin ? <span className="font-mono">{c.gstin}</span> : 'Unregistered for GST'}
        back={{ href: '/sales/customers', label: 'Customers' }}
        actions={
          <>
            <Button asChild variant="secondary"><Link href={`/sales/customers/${id}/edit`}><Pencil size={14} /> Edit</Link></Button>
            <Button asChild variant="secondary"><Link href={`/sales/payments-received/new?customerId=${id}`}>Record receipt</Link></Button>
            <Button asChild><Link href={`/sales/invoices/new?customerId=${id}`}><Plus size={14} /> New invoice</Link></Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500">They owe you</p>
          <p className="mt-1 font-mono text-h2 text-ink-900">{owed.data ? formatPaise(owed.data.paise) : '—'}</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500">Past the due date</p>
          <p className={`mt-1 font-mono text-h2 ${overdue > 0 ? 'text-error-fg' : 'text-ink-400'}`}>{formatPaise(overdue)}</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500">Advance or credit held</p>
          <p className={`mt-1 font-mono text-h2 ${held > 0 ? 'text-pending-fg' : 'text-ink-400'}`}>{formatPaise(held)}</p>
          {held > 0 && <Link href="/sales/payments-received#advances" className="text-caption text-ink-600 hover:underline">Apply or refund it</Link>}
        </div>
      </div>

      <Section title="Details">
        <DetailGrid
          items={[
            ['Place of supply', stateName(c.stateCode ?? c.gstin?.slice(0, 2)) ?? <span className="text-pending-fg">Not set</span>],
            ['PAN', c.pan || c.gstin ? <span className="font-mono">{c.pan ?? c.gstin!.slice(2, 12)}</span> : '—'],
            ...profileDetailItems(c, 'customer'),
            ['Remarks', c.notes ? <span className="whitespace-pre-line">{c.notes}</span> : '—'],
          ]}
        />
        {(c.contactPersons?.length ?? 0) > 0 && (
          <div className="mt-5 border-t border-line-100 pt-4">
            <p className="mb-1 text-caption text-ink-500">Contact persons</p>
            <ContactPersonsList people={c.contactPersons} />
          </div>
        )}
      </Section>

      <Section title="Invoices" actions={<Link href={`/sales/invoices/new?customerId=${id}`} className="text-caption font-medium text-ink-600 hover:underline">New invoice</Link>}>
        {invoices.isError ? (
          <p className="text-caption text-error-fg">{errorText(invoices.error, "Couldn't load the invoices.")}</p>
        ) : theirs.length === 0 ? (
          <p className="text-caption text-ink-400">{invoices.isLoading ? 'Loading…' : 'None yet.'}</p>
        ) : (
          <TableCard className="border-line-100">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Invoice no.</th>
                  <th className={th}>Due</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {theirs.map((i) => (
                  <tr key={i._id} className={rowLink} onClick={() => router.push(`/sales/invoices/${i._id}`)}>
                    <td className={`${td} text-caption`}>{shortDate(i.invoiceDate)}</td>
                    <td className={`${td} font-mono text-caption`}>{i.invoiceNumber ?? <span className="text-ink-400">Not numbered</span>}</td>
                    <td className={`${td} text-caption`}>{shortDate(i.dueDate)}</td>
                    <td className={td}><InvoiceStatusChip status={i.status} /></td>
                    <td className={tdMoney}>{formatPaise(i.totalPaise)}</td>
                    <td className={`${tdMoney} ${i.outstandingPaise > 0 && i.status !== 'draft' ? 'text-pending-fg' : 'text-ink-400'}`}>{i.status === 'draft' ? '—' : formatPaise(i.outstandingPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <PortalLink customerId={id} enabled={c.portalEnabled !== false} />

      <Section>
        <AttachmentsSection entityType="Customer" entityId={id} />
      </Section>

      <Link href={`/audit?entityType=Customer&entityId=${id}`} className="inline-block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
        History of this customer
      </Link>
    </div>
  );
}
