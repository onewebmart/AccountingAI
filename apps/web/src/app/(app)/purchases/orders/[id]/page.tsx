'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { FileDown, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { termsLabel } from '@/components/parties/party-profile';
import { DocTotalsSummary } from '@/components/purchases/purchase-doc-parts';
import { HistoryLink, errorText, shortDate, todayIso, useAccounts, useLedgerRefresh } from '@/components/purchases/purchase-data';
import { PoStatusChip, useGrns, usePurchaseOrder, type PoRow } from '@/components/purchases/po-data';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const qtyCell = 'w-24 rounded-md border border-line-200 bg-white px-2 py-1 text-right font-mono text-caption focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

async function openPdf(path: string) {
  window.open(URL.createObjectURL(await api.blob(path)), '_blank', 'noopener');
}

/** Goods in against the PO: never more of a line than is still to come. */
function ReceiveGoods({ po, onDone }: { po: PoRow; onDone: () => void }) {
  const [qtys, setQtys] = useState(() => po.lines.map((l) => String(Math.max(0, round3(l.qty - l.receivedQty)))));
  const [challan, setChallan] = useState('');
  const [date, setDate] = useState(todayIso());
  const receive = useMutation({
    mutationFn: () => {
      const lines = qtys.map((q, poLine) => ({ poLine, qty: Number(q || 0) })).filter((l) => l.qty > 0);
      if (lines.some((l) => !Number.isFinite(l.qty))) throw new Error('Enter quantities as numbers.');
      if (lines.length === 0) throw new Error('Enter what was received.');
      return api.post<{ number: string }>(`/orders/purchase-orders/${po._id}/receive`, { date, lines, vendorChallanNo: challan.trim() || null });
    },
    onSuccess: (grn) => {
      notify(`Goods received: ${grn.number}`);
      onDone();
    },
    onError: (e) => notify(errorText(e, "Couldn't record the goods."), 'error'),
  });
  return (
    <Section title="Receive goods" description="A goods received note for what came in. It changes no ledger balance.">
      <TableCard>
        <table className="w-full">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className={th}>Line</th>
              <th className={`${th} text-right`}>Still to come</th>
              <th className={`${th} text-right`}>Received now</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i} className="border-b border-line-100 last:border-0">
                <td className={td}>{l.description}</td>
                <td className={`${td} text-right font-mono text-caption`}>{round3(l.qty - l.receivedQty)}</td>
                <td className={`${td} text-right`}>
                  <input className={qtyCell} inputMode="decimal" aria-label={`Received now: ${l.description}`} value={qtys[i] ?? ''} onChange={(e) => setQtys(qtys.map((q, n) => (n === i ? e.target.value : q)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Vendor's challan no.">
          <input className={`${inputClass} w-48`} value={challan} onChange={(e) => setChallan(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Received on">
          <input type="date" className={`${inputClass} w-44`} value={date} min={po.date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button disabled={receive.isPending} onClick={() => receive.mutate()}>{receive.isPending ? 'Saving…' : 'Record goods received'}</Button>
      </div>
    </Section>
  );
}

/** A draft bill for what was received and not yet billed; posted as any bill is. */
function BillFromPo({ po }: { po: PoRow }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const [qtys, setQtys] = useState(() => po.lines.map((l) => String(Math.max(0, round3(l.receivedQty - l.billedQty)))));
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const make = useMutation({
    mutationFn: () => {
      if (!billNumber.trim()) throw new Error("Enter the vendor's bill number.");
      const lines = qtys.map((q, poLine) => ({ poLine, qty: Number(q || 0) })).filter((l) => l.qty > 0);
      if (lines.length === 0) throw new Error('Nothing to bill.');
      return api.post<{ _id: string }>(`/orders/purchase-orders/${po._id}/bill`, { billNumber: billNumber.trim(), billDate, lines });
    },
    onSuccess: (bill) => {
      refresh();
      notify('Draft bill made: check it, then post it to the ledger');
      router.push(`/purchases/bills/${bill._id}`);
    },
    onError: (e) => notify(errorText(e, "Couldn't make the bill."), 'error'),
  });
  return (
    <Section title="Bill" description="Bills what was received and not yet billed, at the PO's rates. Saved as a draft bill.">
      <TableCard>
        <table className="w-full">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className={th}>Line</th>
              <th className={`${th} text-right`}>Received, not billed</th>
              <th className={`${th} text-right`}>Bill now</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i} className="border-b border-line-100 last:border-0">
                <td className={td}>{l.description} <span className="text-caption text-ink-400">@ {formatPaise(l.ratePaise)}</span></td>
                <td className={`${td} text-right font-mono text-caption`}>{round3(l.receivedQty - l.billedQty)}</td>
                <td className={`${td} text-right`}>
                  <input className={qtyCell} inputMode="decimal" aria-label={`Bill now: ${l.description}`} value={qtys[i] ?? ''} onChange={(e) => setQtys(qtys.map((q, n) => (n === i ? e.target.value : q)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Vendor's bill no." required>
          <input className={`${inputClass} w-48 font-mono`} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Bill date">
          <input type="date" className={`${inputClass} w-44`} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        <Button disabled={make.isPending || !billNumber.trim()} onClick={() => make.mutate()}>{make.isPending ? 'Saving…' : 'Make draft bill'}</Button>
      </div>
    </Section>
  );
}

/** One purchase order: its lines and progress, sending it, receiving goods, billing, and its goods notes. */
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const pos = usePurchaseOrder(id);
  const grns = useGrns();
  const chart = useAccounts();
  const accountName = (accountId: string | null | undefined) => (accountId ? chart.data?.find((a) => a._id === String(accountId))?.name ?? 'Account' : null);
  const refetch = () => {
    void pos.refetch();
    void grns.refetch();
  };

  const act = useMutation({
    mutationFn: (action: 'send' | 'close' | 'cancel') => api.post<{ emailed?: boolean }>(`/orders/purchase-orders/${id}/${action}`, {}),
    onSuccess: (r, action) => {
      refetch();
      notify(action === 'send' ? (r?.emailed ? 'PO sent' : 'Marked sent: no email went (the vendor has no email, or mail is not set up)') : action === 'close' ? 'Purchase order closed' : 'Purchase order cancelled', action === 'send' && !r?.emailed ? 'info' : 'success');
    },
    onError: (e) => notify(errorText(e, "Couldn't do that."), 'error'),
  });
  const cancelGrn = useMutation({
    mutationFn: (grnId: string) => api.post(`/orders/grns/${grnId}/cancel`),
    onSuccess: () => {
      refetch();
      notify('Goods note cancelled');
    },
    onError: (e) => notify(errorText(e, "Couldn't cancel the goods note."), 'error'),
  });

  if (pos.isError) return <QueryError error={pos.error} onRetry={() => void pos.refetch()} />;
  if (pos.isLoading) return <p className="text-caption text-ink-400">Loading…</p>;
  const po = pos.data;
  if (!po) return <QueryError error={new Error('This purchase order was not found.')} />;

  const notes = (grns.data ?? []).filter((g) => g.purchaseOrderId === po._id);
  const toBill = po.lines.some((l) => l.receivedQty > l.billedQty + 1e-9);
  const toReceive = po.status === 'open' && po.lines.some((l) => l.qty > l.receivedQty + 1e-9);

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Purchase order <span className="font-mono">{po.number}</span></>}
        meta={<PoStatusChip po={po} />}
        subtitle={<><Link href={`/purchases/vendors/${po.vendorId}`} className="hover:underline">{po.vendorName}</Link> · dated {shortDate(po.date)}{po.expectedBy ? ` · delivery by ${shortDate(po.expectedBy)}` : ''}</>}
        back={{ href: '/purchases/orders', label: 'Purchase orders' }}
        actions={
          <>
            <HistoryLink entityType="PurchaseOrder" entityId={po._id} />
            <Button variant="secondary" onClick={() => void openPdf(`/orders/purchase-orders/${po._id}/pdf`).catch((e) => notify(errorText(e, "Couldn't open the PDF."), 'error'))}>
              <FileDown size={14} /> PDF
            </Button>
            {po.status === 'open' && (
              <>
                <Button variant="secondary" disabled={act.isPending} onClick={() => window.confirm(`Close ${po.number}? Nothing more is expected against it.`) && act.mutate('close')}>Close</Button>
                {notes.every((g) => g.status !== 'received') && (
                  <Button variant="secondary" disabled={act.isPending} onClick={() => window.confirm(`Cancel ${po.number}?`) && act.mutate('cancel')}>Cancel PO</Button>
                )}
                <Button disabled={act.isPending} onClick={() => act.mutate('send')}><Send size={14} /> {po.sentAt ? 'Send PO again' : 'Send PO'}</Button>
              </>
            )}
          </>
        }
      />

      <Section title="Lines">
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Description</th>
                <th className={th}>HSN/SAC</th>
                <th className={th}>Account</th>
                <th className={`${th} text-right`}>Ordered</th>
                <th className={`${th} text-right`}>Received</th>
                <th className={`${th} text-right`}>Billed</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>GST</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={td}>{l.description}</td>
                  <td className={`${td} font-mono text-caption`}>{l.hsnSac ?? '—'}</td>
                  <td className={`${td} text-caption`}>{accountName(l.accountId) ?? (l.itemId ? 'The item’s account' : 'Purchases')}</td>
                  <td className={`${td} text-right font-mono`}>{l.qty}</td>
                  <td className={`${td} text-right font-mono`}>{l.receivedQty}</td>
                  <td className={`${td} text-right font-mono`}>{l.billedQty}</td>
                  <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
                  <td className={`${td} text-right text-caption`}>{l.taxRatePct}%</td>
                  <td className={tdMoney}>
                    {formatPaise(l.amountPaise)}
                    {(l.discountPaise ?? 0) > 0 && <span className="block text-[0.6875rem] text-ink-500">less {formatPaise(l.discountPaise ?? 0)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DetailGrid
            items={[
              ['Reference#', po.referenceNumber ? <span key="r" className="font-mono">{po.referenceNumber}</span> : null],
              ['Delivery date', po.expectedBy ? shortDate(po.expectedBy) : null],
              ['Payment terms', po.paymentTerms ? termsLabel(po.paymentTerms) ?? po.paymentTerms : null],
              ['Shipment preference', po.shipmentPreference ?? null],
              [
                'Deliver to',
                po.deliverTo ? (
                  <span key="d">
                    {po.deliverTo.kind === 'customer' && po.deliverTo.customerId ? <Link href={`/sales/customers/${po.deliverTo.customerId}`} className="hover:underline">{po.deliverTo.name}</Link> : po.deliverTo.name}
                    {po.deliverTo.kind === 'customer' ? ' (customer)' : ''}
                    {po.deliverTo.address && <span className="block whitespace-pre-line text-caption text-ink-500">{po.deliverTo.address}</span>}
                  </span>
                ) : null,
              ],
              ['Sent', po.sentAt ? new Date(po.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not yet'],
              ['Notes', po.notes],
              ['Terms & conditions', po.termsAndConditions ? <span key="t" className="whitespace-pre-line">{po.termsAndConditions}</span> : null],
            ].filter(([label, v]) => v != null || label === 'Sent') as Array<[string, React.ReactNode]>}
          />
          <DocTotalsSummary amounts={po.amountsPaise} lines={po.lines} discount={po.discount} adjustment={po.adjustment} note={po.discount || po.adjustment ? 'Each bill made from this PO carries its share of the discount; a bill for all of it at once carries the adjustment.' : undefined} />
        </div>
      </Section>

      {toReceive && <ReceiveGoods key={`r:${po.lines.map((l) => l.receivedQty).join(',')}`} po={po} onDone={refetch} />}
      {toBill && <BillFromPo key={`b:${po.lines.map((l) => l.billedQty).join(',')}`} po={po} />}

      <Section>
        <AttachmentsSection entityType="PurchaseOrder" entityId={po._id} />
      </Section>

      <Section title="Goods received">
        {notes.length === 0 ? (
          <p className="text-caption text-ink-500">Nothing received yet.</p>
        ) : (
          <TableCard>
            <table className="w-full">
              <thead className="border-b border-line-200 bg-surface-sink">
                <tr>
                  <th className={th}>Goods note</th>
                  <th className={th}>Date</th>
                  <th className={th}>Received</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {notes.map((g) => (
                  <tr key={g._id} className="border-b border-line-100 last:border-0">
                    <td className={`${td} font-mono text-caption`}>
                      {g.number}
                      {g.vendorChallanNo && <span className="block text-ink-400">their challan {g.vendorChallanNo}</span>}
                    </td>
                    <td className={`${td} text-caption`}>{shortDate(g.date)}</td>
                    <td className={`${td} text-caption`}>{g.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}</td>
                    <td className={td}>{g.status === 'received' ? <StatusChip tone="success">Received</StatusChip> : <StatusChip tone="neutral">Cancelled</StatusChip>}</td>
                    <td className={`${td} text-right`}>
                      {g.status === 'received' && (
                        <button
                          type="button"
                          className="text-caption font-medium text-ink-500 hover:text-error-fg"
                          disabled={cancelGrn.isPending}
                          onClick={() => window.confirm(`Cancel goods note ${g.number}?`) && cancelGrn.mutate(g._id)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>
    </div>
  );
}
