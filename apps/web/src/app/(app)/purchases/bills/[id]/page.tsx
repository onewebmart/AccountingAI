'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { useProjects } from '@/components/projects/project-select';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { PoMatch } from '@/components/purchases/po-match';
import { DocTotalsSummary } from '@/components/purchases/purchase-doc-parts';
import { termsLabel } from '@/components/parties/party-profile';
import { useCustomers } from '@/components/sales/sales-data';
import {
  BillStatusChip, HistoryLink, Line, Voucher, dueInfo, errorText, formatMinor, parseMinor, rupeesText, shortDate, todayIso, useAccounts, useBills, useLedgerRefresh,
  type BillRecord, type VendorRecord,
} from '@/components/purchases/purchase-data';

async function openOriginal(documentId: string) {
  const { url } = await api.get<{ url: string }>(`/documents/${documentId}/url`);
  window.open(url, '_blank', 'noopener');
}

/** A payment against this bill: all of what is owed, or part, on the day the money left. */
function RecordPayment({ bill, owedPaise, onDone }: { bill: BillRecord; owedPaise: number; onDone: () => void }) {
  const f = bill.foreign;
  const openMinor = f ? f.totalMinor - f.paidMinor : 0;
  const [amount, setAmount] = useState(f ? (openMinor / 10 ** f.digits).toFixed(f.digits) : rupeesText(owedPaise));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [rate, setRate] = useState(f ? String(f.rate) : '');
  const [held, setHeld] = useState<string | null>(null);

  const paise = f ? null : parseRupees(amount);
  const minor = f ? parseMinor(amount, f.digits) : null;
  const valid = f ? minor !== null && minor > 0 && minor <= openMinor && Number(rate) > 0 : paise !== null && paise > 0 && paise <= owedPaise;
  const inFull = f ? minor === openMinor : paise === owedPaise;

  const pay = useMutation({
    mutationFn: () =>
      f
        ? api.post(`/currency/bills/${bill._id}/pay`, { paidOn, amountMinor: minor, rate: Number(rate) })
        : api.post(`/purchase/bills/${bill._id}/pay`, { paidOn, amountPaise: paise }),
    onSuccess: () => {
      setHeld(null);
      notify(inFull ? 'Payment recorded' : 'Part payment recorded');
      onDone();
    },
    onError: (e) => {
      // A payment approval policy holds it: the request is made, and the server says why.
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
        onDone();
      } else notify(errorText(e, "Couldn't record that payment."), 'error');
    },
  });

  return (
    <Section title="Record payment" description={f ? `In ${f.currency} at the day's rate: the difference from the booked rate ${f.rate} goes to exchange gain or loss.` : 'Posts a payment voucher: Accounts Payable down, Bank down.'}>
      <form
        id="pay"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          pay.mutate();
        }}
      >
        <Field label={f ? `Amount (${f.currency})` : 'Amount (₹)'} hint={f ? `${formatMinor(openMinor, f.currency, f.digits)} owed` : `${formatPaise(owedPaise)} owed`}>
          <input className={`${inputClass} w-40 text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {f && (
          <Field label={`Rate (₹ for 1 ${f.currency})`}>
            <input className={`${inputClass} w-36 text-right font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        )}
        <Field label="Paid on">
          <input type="date" className={`${inputClass} w-44`} value={paidOn} min={bill.billDate} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!valid || !paidOn || pay.isPending} className="mb-[2px]">
          {pay.isPending ? 'Recording…' : inFull ? 'Record payment' : 'Record part payment'}
        </Button>
        <Link href={`/purchases/payments-made/new?vendorId=${bill.vendorId}`} className="mb-3 text-caption font-medium text-ink-600 hover:underline">
          Pay several bills at once
        </Link>
      </form>
      {held && <p className="mt-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">{held} It posts when approved, on the Approvals page.</p>}
    </Section>
  );
}

/** One bill: its lines and tax, posting, payments, debit notes, the PO it matches, and its files. */
export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const refresh = useLedgerRefresh();
  const bill = useQuery({ queryKey: ['purchase', 'bill', id], queryFn: () => api.get<BillRecord>(`/purchase/bills/${id}`) });
  const vendor = useQuery({
    queryKey: ['purchase', 'vendor', bill.data?.vendorId],
    queryFn: () => api.get<VendorRecord>(`/purchase/vendors/${bill.data!.vendorId}`),
    enabled: !!bill.data?.vendorId,
  });
  const row = (useBills().data ?? []).find((b) => b._id === id);
  const projects = useProjects();
  const chart = useAccounts();
  const customers = useCustomers();
  const [held, setHeld] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: () => api.post(`/purchase/bills/${id}/post`),
    onSuccess: () => {
      setHeld(null);
      notify('Posted to ledger');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
        refresh();
      } else notify(errorText(e, "Couldn't post the bill."), 'error');
    },
  });

  if (bill.isError) return <QueryError error={bill.error} onRetry={() => void bill.refetch()} />;
  const b = bill.data;
  if (!b) return <p className="text-caption text-ink-400">Loading…</p>;

  const a = b.amountsPaise;
  const owed = row?.outstandingPaise ?? Math.max(0, a.total - (b.tds?.amountPaise ?? 0) - (b.amountPaidPaise ?? 0) - (b.adjustedPaise ?? 0));
  const due = b.status === 'posted' ? dueInfo(b.dueDate) : null;
  const projectName = (pid: string | null) => (pid ? projects.data?.find((p) => p.id === String(pid))?.name ?? 'Project' : null);
  const hasProjects = b.lineItems.some((l) => l.projectId);
  const hasDiscount = b.lineItems.some((l) => (l.discountPaise ?? 0) > 0);
  const hasCustomers = b.lineItems.some((l) => l.customerId);
  const accountName = (accountId: string | null | undefined) => (accountId ? chart.data?.find((x) => x._id === String(accountId))?.name ?? 'Account' : null);
  const customerName = (customerId: string | null | undefined) => (customerId ? customers.data?.find((c) => c._id === String(customerId))?.name ?? 'Customer' : null);

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Bill <span className="font-mono">{b.billNumber ?? 'with no number'}</span></>}
        meta={<BillStatusChip status={b.status} />}
        subtitle={
          <>
            <Link href={`/purchases/vendors/${b.vendorId}`} className="hover:underline">{vendor.data?.name ?? 'Vendor'}</Link> · dated {shortDate(b.billDate)}
            {due && <span className={due.tone === 'late' ? ' text-error-fg' : due.tone === 'soon' ? ' text-pending-fg' : ''}> · {due.label}</span>}
          </>
        }
        back={{ href: '/purchases/bills', label: 'Bills' }}
        actions={
          <>
            <HistoryLink entityType="PurchaseBill" entityId={b._id} />
            {(b.status === 'posted' || b.status === 'paid') && (
              <Button variant="secondary" asChild>
                <Link href={`/purchases/vendor-credits/new?billId=${b._id}`}>Vendor credit</Link>
              </Button>
            )}
            {b.status === 'posted' && (
              <Button variant="secondary" asChild>
                <a href="#pay">Record payment</a>
              </Button>
            )}
            {b.status === 'draft' && (
              <Button disabled={post.isPending} onClick={() => post.mutate()}>{post.isPending ? 'Posting…' : 'Post to ledger'}</Button>
            )}
          </>
        }
      />

      {held && b.status === 'draft' && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          {held} It posts when approved, on the <Link href="/approvals" className="underline">Approvals</Link> page.
        </p>
      )}
      {row?.msmeLate && (
        <p className="rounded-md border border-error-fg/30 bg-error-bg px-4 py-3 text-body text-error-fg">
          The MSME pay-by day, {shortDate(row.msmePayBy)}, has passed with money owed. Under 43B(h) this expense is deductible only in the year it is paid.
        </p>
      )}

      <Section title="Lines">
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Description</th>
                <th className={th}>HSN/SAC</th>
                <th className={th}>Account</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                {hasDiscount && <th className={`${th} text-right`}>Discount</th>}
                <th className={`${th} text-right`}>GST</th>
                {hasCustomers && <th className={th}>Customer</th>}
                {hasProjects && <th className={th}>Project</th>}
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.lineItems.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-4 text-caption text-ink-500">No lines: the bill was entered as a total.</td></tr>
              ) : (
                b.lineItems.map((l, i) => (
                  <tr key={i} className="border-b border-line-100 last:border-0">
                    <td className={td}>{l.description}</td>
                    <td className={`${td} font-mono text-caption`}>{l.hsnSac ?? '—'}</td>
                    <td className={`${td} text-caption`}>{accountName(l.accountId) ?? (l.itemId ? 'The item’s account' : 'Purchases')}</td>
                    <td className={`${td} text-right font-mono`}>{l.qty}</td>
                    <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
                    {hasDiscount && (
                      <td className={tdMoney}>
                        {(l.discountPaise ?? 0) > 0 ? `− ${formatPaise(l.discountPaise ?? 0)}` : '—'}
                        {l.discountPercent ? <span className="block text-[0.6875rem] text-ink-500">{l.discountPercent}%</span> : null}
                      </td>
                    )}
                    <td className={`${td} text-right text-caption`}>{l.taxRatePct}%</td>
                    {hasCustomers && (
                      <td className={`${td} text-caption`}>
                        {l.customerId ? <Link href={`/sales/customers/${l.customerId}`} className="hover:underline">{customerName(l.customerId)}</Link> : '—'}
                        {l.billable && <span className="ml-1.5"><StatusChip tone="pending">Billable</StatusChip></span>}
                      </td>
                    )}
                    {hasProjects && <td className={`${td} text-caption`}>{projectName(l.projectId) ?? '—'}</td>}
                    <td className={tdMoney}>{formatPaise(l.amountPaise - (l.discountPaise ?? 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableCard>
        <div className="mt-4">
          <DocTotalsSummary
            amounts={a}
            lines={b.lineItems}
            discount={b.discount}
            discountLevel={b.discountLevel}
            adjustment={b.adjustment}
            note={
              <>
                {b.isReverseCharge ? 'Reverse charge: the GST is ours to pay; the vendor is owed the amount before tax. ' : ''}
                {b.tds ? `TDS ${b.tds.section} at ${b.tds.rateBps / 100}%: ${formatPaise(b.tds.amountPaise)} withheld from the vendor.` : ''}
              </>
            }
          />
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Details">
          <DetailGrid
            items={[
              ['Bill date', shortDate(b.billDate)],
              ['Due', shortDate(b.dueDate)],
              ...((b.paymentTerms ? [['Payment terms', termsLabel(b.paymentTerms) ?? b.paymentTerms]] : []) as Array<[string, React.ReactNode]>),
              ...((b.orderNumber ? [['Order number', <span key="o" className="font-mono">{b.orderNumber}</span>]] : []) as Array<[string, React.ReactNode]>),
              ...((b.subject ? [['Subject', b.subject]] : []) as Array<[string, React.ReactNode]>),
              ['Financial year', b.financialYear],
              ['MSME pay by', row?.msmePayBy ? shortDate(row.msmePayBy) : null],
              ['Currency', b.foreign ? `${b.foreign.currency} at ₹${b.foreign.rate}` : 'INR'],
              ...(b.foreign ? ([['In ' + b.foreign.currency, <span key="f" className="font-mono">{formatMinor(b.foreign.totalMinor, b.foreign.currency, b.foreign.digits)}</span>]] as Array<[string, React.ReactNode]>) : []),
              ['Source', b.sourceDocumentId ? 'Read from an upload' : b.recurringTemplateId ? <Link key="r" href="/purchases/recurring-bills" className="hover:underline">A recurring bill</Link> : b.source ? 'A purchase order' : 'Typed in'],
            ]}
          />
          {b.notes && <p className="mt-3 text-caption text-ink-500">{b.notes}</p>}
          {b.sourceDocumentId && (
            <button type="button" onClick={() => void openOriginal(b.sourceDocumentId!)} className="mt-3 inline-flex items-center gap-1.5 text-caption font-medium text-ink-700 hover:text-ink-900">
              <ExternalLink size={12} /> View the original upload
            </button>
          )}
        </Section>

        <Section title="In the ledger">
          <Line label="Posted as">{b.journalId ? <Voucher id={b.journalId} /> : <StatusChip tone="pending">Not posted yet</StatusChip>}</Line>
          {(b.payments ?? []).map((p) => (
            <Line key={p._id ?? p.journalId} label={`Paid ${formatPaise(p.amountPaise)} on ${shortDate(p.paidOn)}`}>
              <Voucher id={p.journalId} />
            </Line>
          ))}
          {(b.adjustments ?? []).map((n) => (
            <Line key={n.noteId} label={<Link href="/purchases/vendor-credits" className="hover:underline">Debit note {formatPaise(n.amountPaise)}</Link>}>
              <Voucher id={n.journalId} />
            </Line>
          ))}
          {b.status !== 'draft' && (
            <Line label="Still owed" strong>
              <span className="font-mono">{formatPaise(b.status === 'paid' ? 0 : owed)}</span>
            </Line>
          )}
        </Section>
      </div>

      {b.status === 'posted' && owed > 0 && <RecordPayment key={`${b._id}:${owed}`} bill={b} owedPaise={owed} onDone={() => { refresh(); void bill.refetch(); }} />}

      <PoMatch billId={b._id} />

      <Section>
        <AttachmentsSection entityType="PurchaseBill" entityId={b._id} />
      </Section>
    </div>
  );
}
