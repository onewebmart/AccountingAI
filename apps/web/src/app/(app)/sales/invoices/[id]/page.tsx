'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, FileDown, Link2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, Section, DetailGrid, TableCard, th, td, tdMoney } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { EinvoiceSection } from '@/components/einvoice/einvoice-section';
import { useProjects } from '@/components/projects/project-select';
import { api, downloadFile } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, fileSafe, formatMinor, shortDate, stateName, useLedgerRefresh, type CustomerRecord, type InvoiceRecord } from '@/components/sales/sales-data';
import { InvoiceStatusChip } from '@/components/sales/status';

interface Reminder {
  _id: string;
  rung: string;
  channel: 'email' | 'whatsapp';
  to: string;
  status: 'queued' | 'sent' | 'failed';
  isMock: boolean;
  error: string | null;
  createdAt: string;
}

const RUNG: Record<string, string> = {
  before_due: '3 days before due',
  on_due: 'On the due date',
  late_7: '7 days late',
  late_15: '15 days late',
  late_30: '30 days late',
  manual: 'Sent by hand',
};

/** A voucher by id, shown by its number. */
function Voucher({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['journals', id], queryFn: () => api.get<{ voucherNumber: string; date: string }>(`/journals/${id}`) });
  return <span className="font-mono">{data ? `${data.voucherNumber} · ${shortDate(data.date)}` : '…'}</span>;
}

function Line({ label, children, strong }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line-100 py-1.5 last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <span className="text-body text-ink-600">{label}</span>
      <span className="text-right text-body text-ink-900">{children}</span>
    </div>
  );
}

/** Getting paid online: a link for what is owed; the gateway's "paid" is confirmed by a person, which posts the receipt. */
function OnlinePayment({ invoice, refresh }: { invoice: InvoiceRecord; refresh: () => void }) {
  const gateway = useQuery({ queryKey: ['payments', 'gateway'], queryFn: () => api.get<{ name: string; isMock: boolean }>('/payments/online/gateway'), retry: false });
  const online = useMutation({
    mutationFn: ({ action }: { action: 'link' | 'confirm' | 'mock-pay' }) => api.post<{ url?: string }>(`/payments/online/${invoice._id}/${action}`),
    onSuccess: async (res, { action }) => {
      refresh();
      if (action === 'link' && res?.url) {
        await navigator.clipboard?.writeText(res.url).catch(() => undefined);
        notify(gateway.data?.isMock ? 'Test payment link copied. It takes no money.' : 'Payment link copied');
      } else if (action === 'confirm') notify('Receipt recorded');
      else if (action === 'mock-pay') notify('Marked paid online (test). Confirm the receipt to post it.', 'info');
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const link = invoice.paymentLink;
  return (
    <Section title="Online payment" description={gateway.data ? `Through ${gateway.data.name}${gateway.data.isMock ? ' (test gateway: no money moves)' : ''}.` : undefined}>
      {link?.status === 'paid' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-pending-fg/30 bg-pending-bg p-3">
          <p className="text-body text-pending-fg">
            The gateway says <span className="font-mono">{formatPaise(link.paidPaise ?? 0)}</span> was paid{link.paidOn ? ` on ${shortDate(link.paidOn)}` : ''}. Confirm to record the receipt.
          </p>
          <Button size="sm" disabled={online.isPending} onClick={() => online.mutate({ action: 'confirm' })}>Paid online · confirm</Button>
        </div>
      ) : link?.status === 'confirmed' ? (
        <p className="text-body text-success-fg">Paid online, and the receipt is recorded.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" disabled={online.isPending} onClick={() => online.mutate({ action: 'link' })}>
            <Link2 size={14} /> {link?.status === 'created' ? 'New payment link' : 'Payment link'}
          </Button>
          {link?.status === 'created' && (
            <>
              <span className="break-all font-mono text-caption text-ink-600">{link.url}</span>
              {gateway.data?.isMock && (
                <Button size="sm" variant="ghost" disabled={online.isPending} onClick={() => online.mutate({ action: 'mock-pay' })}>Test: pay</Button>
              )}
            </>
          )}
          {!link && <span className="text-caption text-ink-500">Makes a link for what is owed and copies it, to send the customer.</span>}
        </div>
      )}
    </Section>
  );
}

function Reminders({ invoiceId, canSend }: { invoiceId: string; canSend: boolean }) {
  const list = useQuery({ queryKey: ['reminders', 'list', invoiceId], queryFn: () => api.get<Reminder[]>(`/reminders?invoiceId=${invoiceId}`), retry: false });
  const send = useMutation({
    mutationFn: () => api.post<{ to: string }>(`/reminders/invoices/${invoiceId}`),
    onSuccess: (r) => {
      void list.refetch();
      notify(`Reminder sent to ${r.to}`);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const rows = list.data ?? [];
  if (!canSend && rows.length === 0) return null;
  return (
    <Section
      title="Payment reminders"
      actions={canSend ? <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate()}><Send size={14} /> {send.isPending ? 'Sending…' : 'Send reminder'}</Button> : undefined}
    >
      {rows.length === 0 ? (
        <p className="text-caption text-ink-400">None sent yet. Automatic reminders are set on <Link href="/sales/recurring-invoices#reminders" className="underline">Recurring Invoices</Link>.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r._id} className="flex flex-wrap justify-between gap-2 text-caption">
              <span className="text-ink-700">{new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {RUNG[r.rung] ?? r.rung} · {r.channel === 'email' ? 'Email' : 'WhatsApp'} to {r.to}</span>
              <span className={r.status === 'failed' ? 'text-error-fg' : r.status === 'sent' ? 'text-success-fg' : 'text-pending-fg'} title={r.error ?? undefined}>
                {r.status === 'sent' ? (r.isMock ? 'Logged (not sent)' : 'Sent') : r.status === 'failed' ? 'Failed' : 'Queued'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** One invoice: its lines and amounts, what posted and settled it, and everything that can be done with it. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const refresh = useLedgerRefresh();
  const invoice = useQuery({ queryKey: ['sales', 'invoice', id], queryFn: () => api.get<InvoiceRecord>(`/sales/invoices/${id}`) });
  const customerId = invoice.data?.customerId;
  const customer = useQuery({
    queryKey: ['sales', 'customer', customerId],
    queryFn: () => api.get<CustomerRecord>(`/sales/customers/${customerId}`),
    enabled: !!customerId,
  });
  const projects = useProjects();

  const send = useMutation({
    mutationFn: () => api.post(`/sales/invoices/${id}/send`),
    onSuccess: () => { refresh(); notify('Marked as sent'); },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const post = useMutation({
    mutationFn: () => api.post(`/sales/invoices/${id}/post`),
    onSuccess: () => { refresh(); notify('Posted to ledger'); },
    onError: (e) => notify(errorText(e, "Couldn't post the invoice."), 'error'),
  });

  if (invoice.isError) return <QueryError error={invoice.error} onRetry={() => void invoice.refetch()} />;
  if (!invoice.data) return <p className="text-caption text-ink-400">Loading…</p>;

  const inv = invoice.data;
  const a = inv.amountsPaise;
  const f = inv.foreign;
  const party = inv.partyAtIssue ?? (customer.data ? { name: customer.data.name, gstin: customer.data.gstin, stateCode: customer.data.stateCode ?? null } : null);
  const owed = a.total - (inv.amountPaidPaise ?? 0) - (inv.adjustedPaise ?? 0);
  const isOpen = inv.status === 'posted' && owed > 0;
  const projectName = (pid: string | null) => (pid ? projects.data?.find((p) => p.id === pid)?.name ?? 'A project' : null);
  const anyProject = inv.lineItems.some((l) => l.projectId);
  const pdf = () =>
    void downloadFile(`/sales/invoices/${id}/pdf`, `Invoice-${fileSafe(inv.invoiceNumber)}.pdf`).catch((e: Error) => notify(e.message || "Couldn't download the PDF", 'error'));

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Invoice <span className="font-mono">{inv.invoiceNumber ?? '(not numbered)'}</span></>}
        meta={<InvoiceStatusChip status={inv.status} />}
        subtitle={
          <>
            {party ? <Link href={`/sales/customers/${inv.customerId}`} className="hover:underline">{party.name}</Link> : '…'} · {shortDate(inv.invoiceDate)} ·{' '}
            <span className="font-mono">{f ? formatMinor(f.totalMinor, f.currency, f.digits) : formatPaise(a.total)}</span>
            {inv.status !== 'draft' && inv.status !== 'paid' && owed > 0 && <span className="text-pending-fg"> · {formatPaise(owed)} owed</span>}
          </>
        }
        back={{ href: '/sales/invoices', label: 'Invoices' }}
        actions={
          <>
            <Button variant="secondary" onClick={pdf}><FileDown size={14} /> PDF</Button>
            {inv.invoiceNumber && (
              <Button asChild variant="secondary"><Link href={`/sales/invoices/${id}/email`}><Mail size={14} /> Email invoice</Link></Button>
            )}
            {inv.status === 'draft' && (
              <Button variant="secondary" disabled={send.isPending} onClick={() => send.mutate()} title="You sent it yourself">Mark sent</Button>
            )}
            {(inv.status === 'posted' || inv.status === 'paid') && (
              <Button asChild variant="secondary"><Link href={`/sales/credit-notes/new?invoiceId=${id}`}>Credit note</Link></Button>
            )}
            {(inv.status === 'draft' || inv.status === 'sent') && (
              <Button disabled={post.isPending} onClick={() => post.mutate()}>{post.isPending ? 'Posting…' : 'Post to ledger'}</Button>
            )}
            {isOpen && (
              <Button asChild><Link href={`/sales/invoices/${id}/receive`}>Mark paid</Link></Button>
            )}
          </>
        }
      />

      {(inv.status === 'draft' || inv.status === 'sent') && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-2 text-body text-pending-fg">
          Not in the books yet. Check the lines and amounts, then post it to the ledger.
        </p>
      )}

      <Section title="Details">
        <DetailGrid
          items={[
            ['Customer', party ? <Link href={`/sales/customers/${inv.customerId}`} className="hover:underline">{party.name}</Link> : '…'],
            ['GSTIN', party?.gstin ? <span className="font-mono">{party.gstin}</span> : 'Unregistered'],
            ['Place of supply', stateName(party?.stateCode ?? party?.gstin?.slice(0, 2)) ?? '—'],
            ['Invoice date', shortDate(inv.invoiceDate)],
            ['Due', shortDate(inv.dueDate)],
            ['Financial year', inv.financialYear ?? '—'],
            [
              'Made from',
              inv.source?.kind === 'quote' ? <Link className="hover:underline" href={`/sales/quotes/${inv.source.id}`}>A quote</Link>
                : inv.source?.kind === 'sales_order' ? <Link className="hover:underline" href={`/sales/orders/${inv.source.id}`}>A sales order</Link>
                : inv.source?.kind === 'project' ? <Link className="hover:underline" href={`/time/projects/${inv.source.id}`}>A project&apos;s time</Link>
                : inv.recurringTemplateId ? <Link className="hover:underline" href="/sales/recurring-invoices">A recurring schedule</Link>
                : inv.sourceDocumentId ? 'An upload'
                : 'Typed in',
            ],
            ...(f ? ([['Currency', `${f.currency} at ₹${f.rate}`], ['Export', inv.exportType === 'lut' ? 'Under LUT, no GST' : '—']] as Array<[string, React.ReactNode]>) : []),
            ...(inv.shippingBill ? ([['Shipping bill', <span key="sb" className="font-mono">{inv.shippingBill.number} · {shortDate(inv.shippingBill.date)} · {inv.shippingBill.portCode}</span>]] as Array<[string, React.ReactNode]>) : []),
            ...(inv.emailedTo ? ([['Emailed to', `${inv.emailedTo}${inv.emailedAt ? ` on ${shortDate(inv.emailedAt)}` : ''}`]] as Array<[string, React.ReactNode]>) : []),
          ]}
        />
        {inv.sourceDocumentId && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-caption font-medium text-ink-700 hover:text-ink-900"
            onClick={() =>
              void api
                .get<{ url: string }>(`/documents/${inv.sourceDocumentId}/url`)
                .then(({ url }) => window.open(url, '_blank', 'noopener'))
                .catch((e: Error) => notify(e.message, 'error'))
            }
          >
            <ExternalLink size={12} /> View the original upload
          </button>
        )}
      </Section>

      <Section title="Lines">
        {inv.lineItems.length === 0 ? (
          <p className="text-caption text-ink-400">No lines were recorded: the amounts below were entered as totals.</p>
        ) : (
          <TableCard className="border-line-100">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Description</th>
                  <th className={th}>HSN/SAC</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>GST</th>
                  {anyProject && <th className={th}>Project</th>}
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.map((l, i) => (
                  <tr key={i} className="border-b border-line-100 last:border-0">
                    <td className={td}>{l.description}</td>
                    <td className={`${td} font-mono text-caption`}>{l.hsnSac ?? '—'}</td>
                    <td className={tdMoney}>{l.qty}{l.uqc ? <span className="ml-1 text-caption text-ink-500">{l.uqc}</span> : null}</td>
                    <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
                    <td className={tdMoney}>{l.taxRatePct}%</td>
                    {anyProject && <td className={`${td} text-caption`}>{projectName(l.projectId) ?? '—'}</td>}
                    <td className={tdMoney}>
                      {formatPaise(l.amountPaise)}
                      {f && f.linesMinor[i] != null && <span className="block text-caption text-ink-500">{formatMinor(f.linesMinor[i], f.currency, f.digits)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Amounts">
          <Line label="Taxable value"><span className="font-mono">{formatPaise(a.taxableValue)}</span></Line>
          {a.cgst > 0 && <Line label="CGST"><span className="font-mono">{formatPaise(a.cgst)}</span></Line>}
          {a.sgst > 0 && <Line label="SGST"><span className="font-mono">{formatPaise(a.sgst)}</span></Line>}
          {a.igst > 0 && <Line label="IGST"><span className="font-mono">{formatPaise(a.igst)}</span></Line>}
          {a.cess > 0 && <Line label="Cess"><span className="font-mono">{formatPaise(a.cess)}</span></Line>}
          <Line label="Total" strong><span className="font-mono">{formatPaise(a.total)}</span></Line>
          {f && <Line label={`In ${f.currency}`}><span className="font-mono">{formatMinor(f.totalMinor, f.currency, f.digits)}</span></Line>}
          {inv.status !== 'draft' && (
            <Line label="Still owed" strong>
              <span className={`font-mono ${owed > 0 ? 'text-pending-fg' : 'text-success-fg'}`}>{formatPaise(Math.max(0, owed))}</span>
              {f && f.totalMinor - f.paidMinor > 0 && <span className="block text-caption font-normal text-ink-500">{formatMinor(f.totalMinor - f.paidMinor, f.currency, f.digits)}</span>}
            </Line>
          )}
        </Section>

        <Section title="In the ledger">
          <Line label="Posted as">{inv.journalId ? <Voucher id={inv.journalId} /> : <span className="text-ink-500">Not posted yet</span>}</Line>
          {(inv.payments ?? []).map((p) => (
            <Line key={p._id} label={<>Received <span className="font-mono">{formatPaise(p.amountPaise)}</span>{p.tdsPaise ? <> + TDS <span className="font-mono">{formatPaise(p.tdsPaise)}</span></> : null}</>}>
              <Voucher id={p.journalId} />
            </Line>
          ))}
          {(inv.adjustments ?? []).map((n) => (
            <Line key={n.noteId} label={<>Credit note <span className="font-mono">{formatPaise(n.amountPaise)}</span></>}>
              <Voucher id={n.journalId} />
            </Line>
          ))}
          {(inv.payments ?? []).length === 0 && (inv.adjustments ?? []).length === 0 && inv.journalId && (
            <p className="pt-2 text-caption text-ink-400">No receipts or credit notes yet.</p>
          )}
          {(inv.adjustments ?? []).length > 0 && (
            <Link href="/sales/credit-notes" className="mt-2 inline-block text-caption font-medium text-ink-600 hover:underline">All credit notes</Link>
          )}
        </Section>
      </div>

      {isOpen && <OnlinePayment invoice={inv} refresh={refresh} />}

      {(inv.status === 'posted' || inv.status === 'paid') && (
        <Section title="E-invoice and e-way bill">
          <EinvoiceSection invoiceId={id} onToast={(m) => notify(m)} />
        </Section>
      )}

      <Reminders invoiceId={id} canSend={(inv.status === 'posted' || inv.status === 'sent') && owed > 0 && !inv.foreign} />

      {inv.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line text-body text-ink-700">{inv.notes}</p>
        </Section>
      )}

      <Section>
        <AttachmentsSection entityType="SalesInvoice" entityId={id} />
      </Section>

      <Link href={`/audit?entityType=SalesInvoice&entityId=${id}`} className="inline-block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
        History of this invoice
      </Link>
    </div>
  );
}
