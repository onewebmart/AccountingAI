'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { api, ApiError } from '@/lib/api';
import { currentFinancialYear, recentFinancialYears } from '@/lib/financial-year';
import { formatRupees } from '@/lib/utils';
import { Form26qPanel } from '@/components/tds/form26q-panel';

// ── Shapes from GET /tds/* (paise) ──────────────────────────────────────────

interface PayableRow {
  billId: string;
  billNumber: string | null;
  billDate: string;
  vendorName: string;
  pan: string | null;
  section: string;
  rateBps: number;
  taxablePaise: number;
  tdsPaise: number;
  depositId: string | null;
}

interface TdsMonth {
  month: string;
  section: string;
  sectionLabel: string;
  deductedPaise: number;
  depositedPaise: number;
  pendingPaise: number;
  dueDate: string;
  overdue: boolean;
}

interface Deposit {
  _id: string;
  month: string;
  section: string;
  amountPaise: number;
  paidOn: string;
  challanNumber: string;
  status: 'posted' | 'reversed';
}

interface ReceivableRow {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  paidOn: string;
  receivedPaise: number;
  tdsPaise: number;
}

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const rate = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
const today = () => new Date().toISOString().slice(0, 10);

function failure(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

const th = 'px-3 py-2 text-caption font-medium text-ink-500';
const td = 'px-3 py-2';

/** One month and section's deposit: the date paid and the challan number the bank gave. */
function DepositForm({ month, onDone }: { month: TdsMonth; onDone: (message?: string) => void }) {
  const qc = useQueryClient();
  const [paidOn, setPaidOn] = useState(today());
  const [challan, setChallan] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/tds/deposits', { month: month.month, section: month.section, paidOn, challanNumber: challan.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tds'] });
      void qc.invalidateQueries({ queryKey: ['journals'] });
      void qc.invalidateQueries({ queryKey: ['reports'] });
      onDone('Deposit recorded');
    },
  });
  const input = 'rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Paid on</span>
        <input type="date" className={input} value={paidOn} min={`${month.month}-01`} onChange={(e) => setPaidOn(e.target.value)} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Challan number (CIN)</span>
        <input className={`${input} font-mono`} value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="e.g. 0510308 07112026 12345" required />
      </label>
      <Button type="submit" disabled={save.isPending || challan.trim().length < 3}>
        {save.isPending ? 'Recording…' : `Record deposit of ${formatRupees(month.pendingPaise)}`}
      </Button>
      <Button type="button" variant="secondary" onClick={() => onDone()}>
        Cancel
      </Button>
      {save.isError && <p className="w-full text-caption text-error-fg">{failure(save.error, "Couldn't record the deposit.")}</p>}
    </form>
  );
}

/**
 * TDS: what was deducted from vendors and is owed to the government, by the
 * month and section it is deposited under; the deposits made; and what
 * customers deducted from us, to check against Form 26AS.
 */
export default function TdsPage() {
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [depositing, setDepositing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const payable = useQuery({
    queryKey: ['tds', 'payable', financialYear],
    queryFn: () => api.get<{ rows: PayableRow[]; months: TdsMonth[] }>(`/tds/payable?financialYear=${financialYear}`),
  });
  const deposits = useQuery({ queryKey: ['tds', 'deposits'], queryFn: () => api.get<Deposit[]>('/tds/deposits') });
  const receivable = useQuery({
    queryKey: ['tds', 'receivable', financialYear],
    queryFn: () => api.get<ReceivableRow[]>(`/tds/receivable?financialYear=${financialYear}`),
  });

  const months = payable.data?.months ?? [];
  const pending = months.filter((m) => m.pendingPaise > 0);
  const overdue = pending.filter((m) => m.overdue);
  const rows = payable.data?.rows ?? [];
  const noPan = rows.filter((r) => !r.pan).length;
  const showToast = (message?: string) => {
    setDepositing(null);
    if (!message) return;
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 font-display text-ink-900">TDS</h1>
          <p className="mt-1 text-body text-ink-500">Tax deducted at source: what you owe the government, what you have paid, and what customers deducted from you.</p>
        </div>
        <select
          value={financialYear}
          onChange={(e) => setFinancialYear(e.target.value)}
          className="rounded-md border border-line-200 bg-surface-card px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
        >
          {recentFinancialYears().map((fy) => (
            <option key={fy} value={fy}>
              FY {fy}
            </option>
          ))}
        </select>
      </div>

      {/* To deposit */}
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h3 font-display text-ink-900">To deposit</h2>
          <p className="text-caption text-ink-500">One challan per month and section, due the 7th of the next month (30 April for March).</p>
        </div>
        {overdue.length > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-error-fg/30 bg-error-bg px-4 py-3">
            <AlertCircle size={16} className="shrink-0 text-error-fg" />
            <p className="text-body text-ink-900">
              {overdue.length} {overdue.length === 1 ? 'deposit is' : 'deposits are'} past due. Interest runs at 1.5% a month from the due date.
            </p>
          </div>
        )}
        {payable.isError ? (
          <QueryError error={payable.error} onRetry={() => void payable.refetch()} />
        ) : payable.isLoading ? (
          <p className="text-caption text-ink-400">Loading…</p>
        ) : months.length === 0 ? (
          <p className="text-body text-ink-500">No TDS deducted from vendors in FY {financialYear}. Set a vendor&apos;s TDS section on the Purchase page and their bills deduct it.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line-200 text-left">
                  <th className={th}>Month</th>
                  <th className={th}>Section</th>
                  <th className={`${th} text-right`}>Deducted</th>
                  <th className={`${th} text-right`}>Deposited</th>
                  <th className={`${th} text-right`}>To deposit</th>
                  <th className={th}>Due</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {months.map((m) => {
                  const key = `${m.month}:${m.section}`;
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td className={td}>{monthLabel(m.month)}</td>
                        <td className={td}>
                          <span className="font-mono">{m.section}</span> <span className="text-caption text-ink-500">{m.sectionLabel}</span>
                        </td>
                        <td className={`${td} text-right font-mono`}>{formatRupees(m.deductedPaise)}</td>
                        <td className={`${td} text-right font-mono text-success-fg`}>{m.depositedPaise ? formatRupees(m.depositedPaise) : '—'}</td>
                        <td className={`${td} text-right font-mono font-medium ${m.overdue ? 'text-error-fg' : 'text-ink-900'}`}>
                          {m.pendingPaise ? formatRupees(m.pendingPaise) : '—'}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {m.dueDate}
                          {m.overdue && <span className="ml-2 rounded-full bg-error-bg px-2 py-0.5 text-caption text-error-fg">Overdue</span>}
                        </td>
                        <td className={`${td} text-right`}>
                          {m.pendingPaise > 0 ? (
                            depositing !== key && (
                              <Button size="sm" onClick={() => setDepositing(key)}>
                                Record deposit
                              </Button>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-caption text-success-fg">
                              <CheckCircle size={12} /> Deposited
                            </span>
                          )}
                        </td>
                      </tr>
                      {depositing === key && (
                        <tr>
                          <td colSpan={7} className="bg-surface-sink/50 px-4 py-3">
                            <DepositForm month={m} onDone={showToast} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pending.length > 0 && (
          <p className="text-caption text-ink-500">
            Recording a deposit posts it: TDS Payable is debited and the bank credited. Pay the challan on the income-tax portal first, then record it here.
          </p>
        )}
      </section>

      {/* Deducted from vendors */}
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
        <h2 className="text-h3 font-display text-ink-900">Deducted from vendors</h2>
        {noPan > 0 && (
          <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-2 text-caption text-ink-900">
            {noPan} {noPan === 1 ? 'bill is' : 'bills are'} for a vendor with no PAN. Without a PAN, TDS is due at 20% or more (section 206AA), and the TDS return needs the PAN. Add it on the vendor.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-caption text-ink-400">None this year.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-body">
              <thead className="sticky top-0 bg-surface-card">
                <tr className="border-b border-line-200 text-left">
                  <th className={th}>Bill date</th>
                  <th className={th}>Vendor</th>
                  <th className={th}>PAN</th>
                  <th className={th}>Section</th>
                  <th className={`${th} text-right`}>On</th>
                  <th className={`${th} text-right`}>TDS</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {rows.map((r) => (
                  <tr key={r.billId}>
                    <td className={`${td} whitespace-nowrap`}>{r.billDate}</td>
                    <td className={td}>
                      {r.vendorName} <span className="font-mono text-caption text-ink-400">{r.billNumber ?? ''}</span>
                    </td>
                    <td className={`${td} font-mono text-caption`}>{r.pan ?? <span className="text-pending-fg">Missing</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="font-mono">{r.section}</span> <span className="text-caption text-ink-500">{rate(r.rateBps)}</span>
                    </td>
                    <td className={`${td} text-right font-mono`}>{formatRupees(r.taxablePaise)}</td>
                    <td className={`${td} text-right font-mono`}>{formatRupees(r.tdsPaise)}</td>
                    <td className={`${td} text-caption`}>
                      {r.depositId ? <span className="text-success-fg">Deposited</span> : <span className="text-pending-fg">To deposit</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Deposits made */}
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
        <h2 className="text-h3 font-display text-ink-900">Deposits made</h2>
        {deposits.isError ? (
          <QueryError error={deposits.error} onRetry={() => void deposits.refetch()} />
        ) : (deposits.data ?? []).length === 0 ? (
          <p className="text-caption text-ink-400">No deposits recorded yet.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line-200 text-left">
                <th className={th}>Paid on</th>
                <th className={th}>For</th>
                <th className={th}>Challan</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {deposits.data!.map((d) => (
                <tr key={d._id} className={d.status === 'reversed' ? 'opacity-60' : ''}>
                  <td className={`${td} whitespace-nowrap`}>{d.paidOn}</td>
                  <td className={td}>
                    {monthLabel(d.month)} · <span className="font-mono">{d.section}</span>
                    {d.status === 'reversed' && <span className="ml-2 text-caption text-ink-500">Reversed</span>}
                  </td>
                  <td className={`${td} font-mono text-caption`}>{d.challanNumber}</td>
                  <td className={`${td} text-right font-mono`}>{formatRupees(d.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Deducted by customers */}
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h3 font-display text-ink-900">Deducted by customers</h2>
          <p className="text-caption text-ink-500">Your credit, once it shows in Form 26AS. Check it there before you claim it.</p>
        </div>
        {receivable.isError ? (
          <QueryError error={receivable.error} onRetry={() => void receivable.refetch()} />
        ) : (receivable.data ?? []).length === 0 ? (
          <p className="text-caption text-ink-400">No customer deducted TDS from a payment in FY {financialYear}.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line-200 text-left">
                <th className={th}>Paid on</th>
                <th className={th}>Customer</th>
                <th className={`${th} text-right`}>Received</th>
                <th className={`${th} text-right`}>TDS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {receivable.data!.map((r, i) => (
                <tr key={`${r.invoiceId}-${i}`}>
                  <td className={`${td} whitespace-nowrap`}>{r.paidOn}</td>
                  <td className={td}>
                    {r.customerName} <span className="font-mono text-caption text-ink-400">{r.invoiceNumber ?? ''}</span>
                  </td>
                  <td className={`${td} text-right font-mono`}>{formatRupees(r.receivedPaise)}</td>
                  <td className={`${td} text-right font-mono`}>{formatRupees(r.tdsPaise)}</td>
                </tr>
              ))}
              <tr className="border-t border-line-200 font-medium">
                <td className={td} colSpan={3}>
                  Total credit
                </td>
                <td className={`${td} text-right font-mono`}>{formatRupees(receivable.data!.reduce((s, r) => s + r.tdsPaise, 0))}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <Form26qPanel financialYear={financialYear} />

      {toast && (
        <div role="status" className="fixed bottom-6 right-6 z-50 rounded-md border border-success-fg bg-success-bg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
