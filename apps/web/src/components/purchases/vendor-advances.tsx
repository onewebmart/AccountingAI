'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, rupeesText, todayIso, useBills, useLedgerRefresh } from './purchase-data';

interface AdvanceRow {
  partyId: string;
  partyName: string;
  unappliedPaise: number;
  payments: number;
}

interface PartyPaymentRow {
  _id: string;
  date: string;
  unappliedPaise: number;
  status: 'posted' | 'reversed';
}

/** A vendor's posted payments still holding money, oldest first. */
async function heldPayments(partyId: string) {
  return (await api.get<PartyPaymentRow[]>(`/payments?kind=payment&partyId=${partyId}`))
    .filter((p) => p.status === 'posted' && p.unappliedPaise > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Money paid to vendors ahead of a bill, or credit from a debit note on a
 * paid bill. Apply it to a bill (a journal settles the bill from the
 * advance), or record the vendor refunding it.
 */
export function VendorAdvances({ vendorId }: { vendorId?: string }) {
  const refresh = useLedgerRefresh();
  const bills = useBills();
  const advances = useQuery({ queryKey: ['payments', 'advances', 'payment'], queryFn: () => api.get<AdvanceRow[]>('/payments/advances?kind=payment') });
  const [working, setWorking] = useState<{ row: AdvanceRow; mode: 'apply' | 'refund' } | null>(null);
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<'bank' | 'cash'>('bank');
  const [date, setDate] = useState(todayIso());

  const apply = useMutation({
    mutationFn: async () => {
      const row = working!.row;
      const bill = (bills.data ?? []).find((b) => b._id === billId);
      if (!bill) throw new Error('Choose the bill.');
      let left = Math.min(bill.outstandingPaise, row.unappliedPaise);
      for (const p of await heldPayments(row.partyId)) {
        if (left <= 0) break;
        const take = Math.min(left, p.unappliedPaise);
        await api.post(`/payments/${p._id}/apply`, { documentId: billId, amountPaise: take, date: date < p.date ? p.date : date });
        left -= take;
      }
    },
    onSuccess: () => {
      refresh();
      setWorking(null);
      notify('Advance applied');
    },
    onError: (e) => notify(errorText(e, "Couldn't apply the advance."), 'error'),
  });

  const refund = useMutation({
    mutationFn: async () => {
      const row = working!.row;
      const wanted = parseRupees(amount) ?? 0;
      if (!(wanted > 0) || wanted > row.unappliedPaise) throw new Error(`Enter up to ${formatPaise(row.unappliedPaise)}.`);
      let left = wanted;
      for (const p of await heldPayments(row.partyId)) {
        if (left <= 0) break;
        const take = Math.min(left, p.unappliedPaise);
        await api.post(`/payments/${p._id}/refund`, { amountPaise: take, date: date < p.date ? p.date : date, via });
        left -= take;
      }
    },
    onSuccess: () => {
      refresh();
      setWorking(null);
      notify('Refund recorded');
    },
    onError: (e) => notify(errorText(e, "Couldn't record the refund."), 'error'),
  });

  const rows = (advances.data ?? []).filter((r) => !vendorId || r.partyId === vendorId);
  if (rows.length === 0) return null;
  const openBills = working ? (bills.data ?? []).filter((b) => b.vendorId === working.row.partyId && b.status === 'posted' && b.outstandingPaise > 0) : [];
  const small = `${inputClass} py-1.5`;

  return (
    <Section title="Advances and credits from vendors" description="Paid ahead of a bill, or credit from a debit note on a paid bill. Apply it to a bill, or record the vendor refunding it." className="border-pending-fg/30 bg-pending-bg">
      <ul className="divide-y divide-line-100">
        {rows.map((r) => (
          <li key={r.partyId} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-body text-ink-900">
                {r.partyName} <span className="ml-2 font-mono font-semibold">{formatPaise(r.unappliedPaise)}</span>
              </span>
              {working?.row.partyId !== r.partyId && (
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setWorking({ row: r, mode: 'apply' }); setBillId(''); }}>Apply to bill</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setWorking({ row: r, mode: 'refund' }); setAmount(rupeesText(r.unappliedPaise)); }}>Record refund received</Button>
                </span>
              )}
            </div>
            {working?.row.partyId === r.partyId && (
              <form
                className="mt-2 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (working.mode === 'apply') apply.mutate();
                  else refund.mutate();
                }}
              >
                {working.mode === 'apply' ? (
                  <label className="block">
                    <span className="mb-1 block text-caption font-medium text-ink-700">Bill</span>
                    <select className={`${small} w-72`} value={billId} onChange={(e) => setBillId(e.target.value)} required>
                      <option value="">Choose…</option>
                      {openBills.map((b) => (
                        <option key={b._id} value={b._id}>{b.billNumber ?? 'No number'} · {formatPaise(b.outstandingPaise)} owed</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-caption font-medium text-ink-700">Amount (₹)</span>
                      <input className={`${small} w-36 text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-caption font-medium text-ink-700">Into</span>
                      <select className={`${small} w-28`} value={via} onChange={(e) => setVia(e.target.value as 'bank' | 'cash')}>
                        <option value="bank">Bank</option>
                        <option value="cash">Cash</option>
                      </select>
                    </label>
                  </>
                )}
                <label className="block">
                  <span className="mb-1 block text-caption font-medium text-ink-700">On</span>
                  <input type="date" className={`${small} w-44`} value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <Button type="submit" size="sm" disabled={apply.isPending || refund.isPending || (working.mode === 'apply' && !billId)}>
                  {working.mode === 'apply' ? (apply.isPending ? 'Applying…' : 'Apply advance') : refund.isPending ? 'Recording…' : 'Record refund received'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setWorking(null)}>Cancel</Button>
                {working.mode === 'apply' && openBills.length === 0 && <p className="w-full text-caption text-ink-500">No open bills from {r.partyName} yet.</p>}
              </form>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
