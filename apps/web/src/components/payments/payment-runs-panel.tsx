'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, downloadFile } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { formatRupees } from '@/lib/utils';

interface Candidate {
  billId: string;
  vendorName: string;
  billNumber: string | null;
  dueDate: string | null;
  owedPaise: number;
  msmePayBy: string | null;
  priority: 'msme_late' | 'msme_due' | 'overdue' | 'due';
  reason: string;
  included: boolean;
  hasBankAccount: boolean;
}

interface Run {
  _id: string;
  status: 'draft' | 'paid' | 'cancelled';
  payOn: string;
  totalPaise: number;
  items: Array<{ billId: string; vendorName: string; billNumber: string | null; amountPaise: number }>;
  exportedAt: string | null;
  paidOn: string | null;
}

const PRIORITY: Record<Candidate['priority'], { label: string; className: string }> = {
  msme_late: { label: 'MSME, late', className: 'bg-error-bg text-error-fg' },
  msme_due: { label: 'MSME', className: 'bg-pending-bg text-pending-fg' },
  overdue: { label: 'Overdue', className: 'bg-error-bg text-error-fg' },
  due: { label: 'Due', className: 'bg-surface-sink text-ink-700' },
};

function failure(err: unknown, fallback: string) {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/**
 * Paying vendors in a batch: the suggestion ranks what must go first, the
 * person chooses, downloads the bank's bulk-payment file, pays through the
 * bank, and records the run as paid. Nothing is paid from here.
 */
export function PaymentRunsPanel({ onToast }: { onToast: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [payOn, setPayOn] = useState(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [limit, setLimit] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const runs = useQuery({ queryKey: ['payments', 'runs'], queryFn: () => api.get<Run[]>('/payments/runs') });

  const suggest = useMutation({
    mutationFn: () => api.post<{ candidates: Candidate[]; includedPaise: number; bankBalancePaise: number }>('/payments/runs/suggest', { payOn, cashLimitPaise: limit.trim() ? parseRupees(limit) ?? undefined : undefined }),
    onSuccess: (s) => setPicked(Object.fromEntries(s.candidates.map((c) => [c.billId, c.included]))),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Run>('/payments/runs', {
        payOn,
        items: (suggest.data?.candidates ?? []).filter((c) => picked[c.billId]).map((c) => ({ billId: c.billId, amountPaise: c.owedPaise })),
      }),
    onSuccess: () => {
      suggest.reset();
      setPicked({});
      void queryClient.invalidateQueries({ queryKey: ['payments', 'runs'] });
      onToast('Payment run saved');
    },
  });
  const act = useMutation({
    mutationFn: async ({ run, action }: { run: Run; action: 'file' | 'paid' | 'cancel' }) => {
      if (action === 'file') return downloadFile(`/payments/runs/${run._id}/bank-file`, `payment-run-${run.payOn}.csv`);
      if (action === 'paid') return api.post<{ recorded: number; failed: Array<{ vendorName: string; reason: string }> }>(`/payments/runs/${run._id}/paid`, { paidOn });
      return api.post(`/payments/runs/${run._id}/cancel`);
    },
    onSuccess: (res, { action }) => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase'] });
      if (action === 'paid' && res && typeof res === 'object' && 'recorded' in res) {
        const r = res as { recorded: number; failed: Array<{ vendorName: string; reason: string }> };
        onToast(r.failed.length ? `Recorded ${r.recorded}; not recorded: ${r.failed.map((f) => `${f.vendorName} (${f.reason})`).join('; ')}` : `Recorded ${r.recorded} vendor payment${r.recorded === 1 ? '' : 's'}`);
      } else if (action === 'cancel') onToast('Payment run cancelled');
      else if (action === 'file') onToast('Bank file downloaded. Check it against your bank’s template before uploading.');
    },
    onError: (err) => onToast(failure(err, "Couldn't do that")),
  });

  const candidates = suggest.data?.candidates ?? [];
  const chosen = candidates.filter((c) => picked[c.billId]);
  const chosenPaise = chosen.reduce((s, c) => s + c.owedPaise, 0);
  const field = 'rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const drafts = (runs.data ?? []).filter((r) => r.status === 'draft');
  const done = (runs.data ?? []).filter((r) => r.status === 'paid').slice(0, 5);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-4">
        <div>
          <h3 className="text-body font-semibold text-ink-900">Plan a payment run</h3>
          <p className="text-caption text-ink-500">MSME vendors first (43B(h)), then overdue bills, then what falls due by the pay date. A cash limit keeps it to what the bank can spare.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Pay on</span>
            <input type="date" className={field} value={payOn} onChange={(e) => setPayOn(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Cash limit (₹, optional)</span>
            <input className={`${field} w-36 text-right font-mono`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <Button variant="secondary" disabled={suggest.isPending} onClick={() => suggest.mutate()} className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest a run'}
          </Button>
          {suggest.data && <span className="pb-2 text-caption text-ink-500">Bank balance in the books: {formatRupees(suggest.data.bankBalancePaise)}</span>}
        </div>
        {suggest.isError && <p className="text-caption text-error-fg">{failure(suggest.error, "Couldn't suggest a run.")}</p>}
        {suggest.data && candidates.length === 0 && <p className="text-caption text-ink-500">Nothing needs paying by then.</p>}
        {candidates.length > 0 && (
          <>
            <div className="divide-y divide-line-100 rounded-md border border-line-200">
              {candidates.map((c) => (
                <label key={c.billId} className="flex cursor-pointer items-start gap-3 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={!!picked[c.billId]} onChange={(e) => setPicked({ ...picked, [c.billId]: e.target.checked })} />
                  <span className="min-w-0 flex-1">
                    <span className="text-body text-ink-900">
                      {c.vendorName} <span className="font-mono text-caption text-ink-500">{c.billNumber ?? ''}</span>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-caption font-medium ${PRIORITY[c.priority].className}`}>{PRIORITY[c.priority].label}</span>
                    </span>
                    <span className="block text-caption text-ink-500">{c.reason}</span>
                  </span>
                  <span className="font-mono text-body text-ink-900">{formatRupees(c.owedPaise)}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-body">
                {chosen.length} bill{chosen.length === 1 ? '' : 's'} · <span className="font-mono font-semibold">{formatRupees(chosenPaise)}</span>
              </span>
              <Button disabled={chosen.length === 0 || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Save payment run'}
              </Button>
            </div>
            {create.isError && <p className="text-caption text-error-fg">{failure(create.error, "Couldn't save the run.")}</p>}
          </>
        )}
      </section>

      {drafts.map((run) => (
        <section key={run._id} className="space-y-2 rounded-lg border border-pending-fg/30 bg-pending-bg p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body font-semibold text-ink-900">
              Run for {run.payOn} · {run.items.length} bill{run.items.length === 1 ? '' : 's'} · <span className="font-mono">{formatRupees(run.totalPaise)}</span>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ run, action: 'file' })}>
                Download bank file
              </Button>
              <input type="date" aria-label="Paid on" className={field} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              <Button size="sm" disabled={act.isPending} onClick={() => window.confirm(`Record ${run.items.length} bill${run.items.length === 1 ? '' : 's'} as paid on ${paidOn}? This posts the payments.`) && act.mutate({ run, action: 'paid' })}>
                Record as paid
              </Button>
              <button type="button" className="pb-1 text-caption font-medium text-ink-500 hover:text-error-fg" disabled={act.isPending} onClick={() => act.mutate({ run, action: 'cancel' })}>
                Cancel run
              </button>
            </div>
          </div>
          <p className="text-caption text-ink-600">{run.items.map((i) => `${i.vendorName} ${i.billNumber ?? ''} ${formatRupees(i.amountPaise)}`).join(' · ')}</p>
          {!run.exportedAt && <p className="text-caption text-ink-500">Download the file, upload it to your bank, and once the bank has paid, record the run as paid.</p>}
        </section>
      ))}

      {done.length > 0 && (
        <section className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">Paid runs</p>
          <ul className="divide-y divide-line-100">
            {done.map((r) => (
              <li key={r._id} className="flex justify-between py-1.5 text-body">
                <span>
                  {r.paidOn} · {r.items.length} bill{r.items.length === 1 ? '' : 's'}
                </span>
                <span className="font-mono">{formatRupees(r.totalPaise)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
