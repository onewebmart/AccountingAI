'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, downloadFile } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { addDaysIso, errorText, shortDate, todayIso, useLedgerRefresh } from '@/components/purchases/purchase-data';
import { ModuleGuide } from '@/components/guide/module-guide';

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

const PRIORITY: Record<Candidate['priority'], { label: string; tone: 'error' | 'pending' | 'neutral' }> = {
  msme_late: { label: 'MSME, late', tone: 'error' },
  msme_due: { label: 'MSME', tone: 'pending' },
  overdue: { label: 'Overdue', tone: 'error' },
  due: { label: 'Due', tone: 'neutral' },
};

/** One saved run waiting to be paid: download the bank file, pay through the bank, record it as paid. */
function DraftRun({ run }: { run: Run }) {
  const refresh = useLedgerRefresh();
  const [paidOn, setPaidOn] = useState(todayIso());
  const act = useMutation({
    mutationFn: async (action: 'file' | 'paid' | 'cancel') => {
      if (action === 'file') {
        await downloadFile(`/payments/runs/${run._id}/bank-file`, `payment-run-${run.payOn}.csv`);
        return null;
      }
      if (action === 'paid') return api.post<{ recorded: number; failed: Array<{ vendorName: string; reason: string }> }>(`/payments/runs/${run._id}/paid`, { paidOn });
      return api.post(`/payments/runs/${run._id}/cancel`);
    },
    onSuccess: (res, action) => {
      refresh();
      if (action === 'paid' && res && typeof res === 'object' && 'recorded' in res) {
        const r = res as { recorded: number; failed: Array<{ vendorName: string; reason: string }> };
        if (r.failed.length) notify(`Recorded ${r.recorded}; not recorded: ${r.failed.map((f) => `${f.vendorName} (${f.reason})`).join('; ')}`, 'error');
        else notify(`Recorded ${r.recorded} vendor payment${r.recorded === 1 ? '' : 's'}`);
      } else if (action === 'cancel') notify('Payment run cancelled');
      else if (action === 'file') notify('Bank file downloaded. Check it against your bank’s template before uploading.', 'info');
    },
    onError: (e) => notify(errorText(e, "Couldn't do that."), 'error'),
  });

  return (
    <Section
      className="border-pending-fg/30 bg-pending-bg"
      title={<>Run for {shortDate(run.payOn)} · {run.items.length} bill{run.items.length === 1 ? '' : 's'} · <span className="font-mono">{formatPaise(run.totalPaise)}</span></>}
      description={run.exportedAt ? `Bank file downloaded ${new Date(run.exportedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Once the bank has paid, record the run as paid.` : 'Download the file, upload it to your bank, and once the bank has paid, record the run as paid.'}
      actions={<StatusChip tone="pending">Waiting to be paid</StatusChip>}
    >
      <TableCard className="bg-white">
        <table className="w-full">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className={th}>Vendor</th>
              <th className={th}>Bill</th>
              <th className={`${th} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((i) => (
              <tr key={i.billId} className="border-b border-line-100 last:border-0">
                <td className={td}>{i.vendorName}</td>
                <td className={`${td} font-mono text-caption`}>{i.billNumber ?? '—'}</td>
                <td className={tdMoney}>{formatPaise(i.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('file')}>Download bank file</Button>
        <Field label="Paid on">
          <input type="date" className={`${inputClass} w-44 py-1.5`} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Button
          size="sm"
          disabled={act.isPending}
          onClick={() => window.confirm(`Record ${run.items.length} bill${run.items.length === 1 ? '' : 's'} as paid on ${paidOn}? This posts the payments.`) && act.mutate('paid')}
        >
          Record as paid
        </Button>
        <button
          type="button"
          className="pb-2 text-caption font-medium text-ink-500 hover:text-error-fg"
          disabled={act.isPending}
          onClick={() => window.confirm('Cancel this run? Nothing has been paid from it.') && act.mutate('cancel')}
        >
          Cancel run
        </button>
      </div>
    </Section>
  );
}

/**
 * Paying vendors in a batch. The suggestion ranks what must go first (MSME
 * vendors under 43B(h), then late bills, then what falls due); you choose,
 * download the bank's bulk-payment file, pay through the bank, and record
 * the run as paid. Nothing is paid from here.
 */
export default function PaymentRunsPage() {
  const refresh = useLedgerRefresh();
  const [payOn, setPayOn] = useState(addDaysIso(todayIso(), 7));
  const [limit, setLimit] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const runs = useQuery({ queryKey: ['payments', 'runs'], queryFn: () => api.get<Run[]>('/payments/runs') });

  const suggest = useMutation({
    mutationFn: () => {
      const cash = limit.trim() ? parseRupees(limit) : undefined;
      if (cash === null) throw new Error('Enter the cash limit in rupees.');
      return api.post<{ candidates: Candidate[]; includedPaise: number; bankBalancePaise: number }>('/payments/runs/suggest', { payOn, cashLimitPaise: cash });
    },
    onSuccess: (s) => setPicked(Object.fromEntries(s.candidates.map((c) => [c.billId, c.included]))),
    onError: (e) => notify(errorText(e, "Couldn't suggest a run."), 'error'),
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
      refresh();
      notify('Payment run saved');
    },
    onError: (e) => notify(errorText(e, "Couldn't save the run."), 'error'),
  });

  const candidates = suggest.data?.candidates ?? [];
  const chosen = candidates.filter((c) => picked[c.billId]);
  const chosenPaise = chosen.reduce((s, c) => s + c.owedPaise, 0);
  const drafts = (runs.data ?? []).filter((r) => r.status === 'draft');
  const done = (runs.data ?? []).filter((r) => r.status !== 'draft');

  return (
    <div className="space-y-5">
      <PageHeader guide="paymentRuns" title="Payment runs" subtitle="Pay many vendors at once through your bank's bulk-payment file. MSME vendors first." />

      <Section title="Plan a payment run" description="MSME vendors first (43B(h)), then late bills, then what falls due by the pay date. A cash limit keeps it to what the bank can spare.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Pay on">
            <input type="date" className={`${inputClass} w-44`} value={payOn} onChange={(e) => setPayOn(e.target.value)} />
          </Field>
          <Field label="Cash limit (₹, optional)">
            <input className={`${inputClass} w-40 text-right font-mono`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Button variant="secondary" disabled={suggest.isPending} onClick={() => suggest.mutate()} className="mb-[1px] flex items-center gap-1.5">
            <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest a run'}
          </Button>
          {suggest.data && <span className="pb-3 text-caption text-ink-500">Bank balance in the books: <span className="font-mono">{formatPaise(suggest.data.bankBalancePaise)}</span></span>}
        </div>

        {suggest.data && candidates.length === 0 && <p className="mt-4 text-caption text-ink-500">Nothing needs paying by then.</p>}
        {candidates.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="rounded-md bg-honey-100 px-3 py-2 text-caption text-pending-fg">Suggested. Untick anything you do not want to pay in this run.</p>
            <div className="divide-y divide-line-100 rounded-md border border-line-200">
              {candidates.map((c) => (
                <label key={c.billId} className="flex cursor-pointer items-start gap-3 px-3 py-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-saffron-600" checked={!!picked[c.billId]} onChange={(e) => setPicked({ ...picked, [c.billId]: e.target.checked })} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-body text-ink-900">
                      {c.vendorName} <span className="font-mono text-caption text-ink-500">{c.billNumber ?? ''}</span>
                      <StatusChip tone={PRIORITY[c.priority].tone}>{PRIORITY[c.priority].label}</StatusChip>
                      {!c.hasBankAccount && <span className="text-caption text-error-fg">No bank account on file</span>}
                    </span>
                    <span className="block text-caption text-ink-500">{c.reason}</span>
                  </span>
                  <span className="font-mono text-body tabular-nums text-ink-900">{formatPaise(c.owedPaise)}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-body">
                {chosen.length} bill{chosen.length === 1 ? '' : 's'} · <span className="font-mono font-semibold">{formatPaise(chosenPaise)}</span>
              </span>
              <Button disabled={chosen.length === 0 || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Save payment run'}
              </Button>
            </div>
          </div>
        )}
      </Section>

      {drafts.map((run) => <DraftRun key={run._id} run={run} />)}

      {/* No run yet: show how a payment run works. */}
      {runs.data?.length === 0 && !suggest.data && <ModuleGuide guide="paymentRuns" />}

      <Section title="Past runs">
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Pay on</th>
                <th className={th}>Paid on</th>
                <th className={th}>Bills</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {runs.isLoading ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : runs.isError ? (
                <TableError error={runs.error} colSpan={5} onRetry={() => void runs.refetch()} />
              ) : done.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-caption text-ink-500">No runs paid or cancelled yet.</td></tr>
              ) : (
                done.map((r) => (
                  <tr key={r._id} className="border-b border-line-100 last:border-0">
                    <td className={`${td} text-caption`}>{shortDate(r.payOn)}</td>
                    <td className={`${td} text-caption`}>{shortDate(r.paidOn)}</td>
                    <td className={`${td} text-caption`}>{r.items.map((i) => i.vendorName).join(', ')}</td>
                    <td className={td}>{r.status === 'paid' ? <StatusChip tone="success">Paid</StatusChip> : <StatusChip tone="neutral">Cancelled</StatusChip>}</td>
                    <td className={tdMoney}>{formatPaise(r.totalPaise)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableCard>
      </Section>
    </div>
  );
}
