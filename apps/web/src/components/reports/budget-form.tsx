'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { SearchSelect } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { errorText, todayIso, useAccounts, type Account } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { type BudgetPeriod, PERIOD_NAMES, fyChoices, fyOf, periodCount, periodLabels, splitToMonths, sumToPeriods } from './budget-periods';

export interface BudgetDetail {
  id: string;
  name: string;
  financialYear: string;
  period: BudgetPeriod;
  includeBalanceSheet: boolean;
  isDefault: boolean;
  status: 'active' | 'archived';
  rows: Array<{ accountId: string; name: string; code: string; type: string | null; monthsPaise: number[]; amountsPaise: number[] }>;
}

type Type = 'INCOME' | 'EXPENSE' | 'ASSETS' | 'LIABILITIES' | 'CAPITAL';
const SECTIONS: Array<{ type: Type; title: string; balanceSheet: boolean }> = [
  { type: 'INCOME', title: 'Income accounts', balanceSheet: false },
  { type: 'EXPENSE', title: 'Expense accounts', balanceSheet: false },
  { type: 'ASSETS', title: 'Asset accounts', balanceSheet: true },
  { type: 'LIABILITIES', title: 'Liability accounts', balanceSheet: true },
  { type: 'CAPITAL', title: 'Capital accounts', balanceSheet: true },
];
/** Each account's plan as typed: one rupee amount per period. */
interface Row { accountId: string; cells: string[] }

/** Paise as a person types rupees: 1234500 → "12345", 1234567 → "12345.67", nil → "". */
function toText(paise: number): string {
  if (!paise) return '';
  const s = String(Math.abs(paise)).padStart(3, '0');
  const rupees = s.slice(0, -2);
  const dec = s.slice(-2);
  return `${paise < 0 ? '-' : ''}${rupees}${dec === '00' ? '' : `.${dec}`}`;
}
const cellClass = 'w-24 rounded border border-line-200 bg-white px-1.5 py-1 text-right font-mono text-caption focus:outline-none focus:ring-2 focus:ring-brand-600/40';

/**
 * A budget as a page: its name, year and period, the accounts it plans,
 * and the grid to fill by period with totals for each row and column.
 * Amounts by quarter, half-year or year are kept as months (split to the
 * paisa, the remainder on the last month), so budget against actual reads
 * any budget the same way. A plan, not an entry: it never touches the books.
 */
export function BudgetForm({ initial }: { initial?: BudgetDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const accounts = useAccounts().data ?? [];
  const [name, setName] = useState(initial?.name ?? '');
  const [fy, setFy] = useState(initial?.financialYear ?? fyOf(todayIso()));
  const [period, setPeriod] = useState<BudgetPeriod>(initial?.period ?? 'monthly');
  const [includeBs, setIncludeBs] = useState(initial?.includeBalanceSheet ?? false);
  const [rows, setRows] = useState<Row[]>(() => (initial?.rows ?? []).map((r) => ({ accountId: r.accountId, cells: r.amountsPaise.map(toText) })));
  const [changePct, setChangePct] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(accounts.map((a) => [a._id, a])), [accounts]);
  const typeOf = (id: string) => (byId.get(id)?.type ?? initial?.rows.find((r) => r.accountId === id)?.type ?? '') as Type;
  const nameOf = (id: string) => byId.get(id)?.name ?? initial?.rows.find((r) => r.accountId === id)?.name ?? 'Account';
  const labels = periodLabels(period, fy);
  const count = periodCount(period);
  const prevFy = `${Number(fy.slice(0, 4)) - 1}-${fy.slice(2, 4)}`;
  const visible = SECTIONS.filter((s) => !s.balanceSheet || includeBs);
  const paise = (v: string) => parseRupees(v.trim() || '0');
  const rowTotal = (r: Row) => r.cells.reduce((s, v) => s + (paise(v) ?? 0), 0);
  const columnTotals = (type: Type) => labels.map((_, i) => rows.filter((r) => typeOf(r.accountId) === type).reduce((s, r) => s + (paise(r.cells[i] ?? '') ?? 0), 0));

  /** Amounts by the old period become months, then the new period's sums: nothing is lost. */
  const changePeriod = (next: BudgetPeriod) => {
    setRows((all) => all.map((r) => {
      const typed = r.cells.map((v) => paise(v) ?? 0);
      return { ...r, cells: sumToPeriods(next, splitToMonths(period, typed)).map(toText) };
    }));
    setPeriod(next);
  };
  const add = (id: string) => {
    if (!id || rows.some((r) => r.accountId === id)) return;
    setRows((all) => [...all, { accountId: id, cells: Array(count).fill('') }]);
  };
  const addAll = (type: Type) => {
    const have = new Set(rows.map((r) => r.accountId));
    const more = accounts.filter((a) => a.type === type && !a.isGroup && a.isActive && !have.has(a._id));
    setRows((all) => [...all, ...more.map((a) => ({ accountId: a._id, cells: Array(count).fill('') }))]);
  };
  const remove = (id: string) => setRows((all) => all.filter((r) => r.accountId !== id));
  const setCell = (id: string, i: number, v: string) => setRows((all) => all.map((r) => (r.accountId === id ? { ...r, cells: r.cells.map((c, n) => (n === i ? v : c)) } : r)));
  const toggleBs = (on: boolean) => {
    setIncludeBs(on);
    if (!on) setRows((all) => all.filter((r) => ['INCOME', 'EXPENSE'].includes(typeOf(r.accountId))));
  };

  const fill = useMutation({
    mutationFn: () => {
      const pct = Number(changePct);
      if (!Number.isFinite(pct) || pct <= -100 || pct > 500) throw new Error('The change is a percentage above −100, like 10 or −5.');
      return api.post<{ rows: Array<{ accountId: string; monthsPaise: number[] }> }>('/reports/budgets/from-year', {
        financialYear: fy, fromYear: prevFy, changePct: pct, includeBalanceSheet: includeBs, ...(rows.length ? { accountIds: rows.map((r) => r.accountId) } : {}),
      });
    },
    onSuccess: (r) => {
      const got = new Map(r.rows.map((x) => [x.accountId, sumToPeriods(period, x.monthsPaise).map(toText)]));
      setRows((all) => {
        const filled = all.map((row) => ({ ...row, cells: got.get(row.accountId) ?? Array(count).fill('') }));
        // With no accounts chosen yet, every account with a figure last year comes in.
        const have = new Set(all.map((x) => x.accountId));
        const more = all.length ? [] : [...got].filter(([id]) => !have.has(id) && byId.get(id)).map(([accountId, cells]) => ({ accountId, cells }));
        return [...filled, ...more];
      });
      notify(r.rows.length ? `Filled from FY ${prevFy}: check it, then save` : `Nothing was booked in FY ${prevFy} to fill from`);
    },
    onError: (err) => setError(errorText(err, "Couldn't fill from last year.")),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(), financialYear: fy, period, includeBalanceSheet: includeBs,
        rows: rows.map((r) => {
          const amounts = r.cells.map((v) => paise(v));
          if (amounts.some((v) => v === null)) throw new Error(`${nameOf(r.accountId)}: type amounts in rupees, like 25,000.`);
          if (['INCOME', 'EXPENSE'].includes(typeOf(r.accountId)) && amounts.some((v) => (v as number) < 0)) throw new Error(`${nameOf(r.accountId)}: income and expense budgets are not below nil.`);
          return { accountId: r.accountId, amountsPaise: amounts as number[] };
        }),
      };
      return initial ? api.put<{ id: string }>(`/reports/budgets/${initial.id}`, body) : api.post<{ id: string }>('/reports/budgets', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      notify('Budget saved');
      router.push('/accountant/budgets');
    },
    onError: (err) => setError(errorText(err, "Couldn't save the budget.")),
  });

  const submit = () => {
    if (!name.trim()) return setError('Give the budget a name.');
    setError(null);
    save.mutate();
  };

  const options = (type: Type) =>
    accounts
      .filter((a: Account) => a.type === type && !a.isGroup && a.isActive && !rows.some((r) => r.accountId === a._id))
      .map((a) => ({ value: a._id, label: a.name, detail: a.code }));
  const income = columnTotals('INCOME');
  const expense = columnTotals('EXPENSE');
  const profitRow = (
    <tr key="profit" className="border-b border-line-200 bg-surface-sink font-medium">
      <td className="sticky left-0 bg-surface-sink px-2 py-2 text-ink-900">Net profit</td>
      {labels.map((l, i) => <td key={l} className="whitespace-nowrap px-1 py-2 text-right font-mono text-ink-900">{formatPaise(income[i] - expense[i])}</td>)}
      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-ink-900">{formatPaise(income.reduce((a, b) => a + b, 0) - expense.reduce((a, b) => a + b, 0))}</td>
      <td />
    </tr>
  );

  return (
    <FormPage
      onSubmit={submit}
      error={error}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save budget'}</Button>
          <Link href="/accountant/budgets"><Button type="button" variant="secondary">Cancel</Button></Link>
        </>
      }
    >
      <Section title="Budget">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Name" required>
            <input className={inputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Plan 2026-27" />
          </Field>
          <Field label="Financial year" required hint={initial ? 'A budget stays with its year; make a new one for another.' : 'April to March.'}>
            <select className={inputClass} value={fy} onChange={(e) => setFy(e.target.value)} disabled={!!initial}>
              {[...new Set([...fyChoices(todayIso()), fy])].sort().reverse().map((y) => <option key={y} value={y}>FY {y}</option>)}
            </select>
          </Field>
          <Field label="Budget period" required hint="How you type the amounts. They are kept by month either way.">
            <select className={inputClass} value={period} onChange={(e) => changePeriod(e.target.value as BudgetPeriod)}>
              {(Object.keys(PERIOD_NAMES) as BudgetPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_NAMES[p]}</option>)}
            </select>
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-body text-ink-800">
          <input type="checkbox" checked={includeBs} onChange={(e) => toggleBs(e.target.checked)} />
          Include asset, liability and capital accounts in the budget
        </label>
        <p className="mt-1 text-caption text-ink-500">Their budget is the movement you plan in each period, set against what posted entries move them by. Below nil is allowed for these.</p>
      </Section>

      <Section title="Accounts" description="Add the accounts to plan; each gets a row in the grid below.">
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((s) => (
            <Field key={s.type} label={s.title}>
              <div className="flex gap-2">
                <SearchSelect className="flex-1" value="" onChange={add} options={options(s.type)} placeholder="Add accounts" searchPlaceholder="Type an account" aria-label={`Add ${s.title.toLowerCase()}`} />
                <Button type="button" variant="secondary" size="sm" onClick={() => addAll(s.type)} disabled={!options(s.type).length}><Plus size={13} /> All</Button>
              </div>
            </Field>
          ))}
        </div>
      </Section>

      <Section
        title="Amounts"
        description={`Rupees ${period === 'monthly' ? 'for each month' : period === 'yearly' ? 'for the year' : `for each ${period === 'quarterly' ? 'quarter' : 'half-year'}`}, FY ${fy}.`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-500">
              <span className="mb-1 block">From FY {prevFy}, changed by %</span>
              <input className="h-9 w-20 rounded-md border border-line-200 bg-white px-2 text-right font-mono text-body" inputMode="decimal" value={changePct} onChange={(e) => setChangePct(e.target.value)} aria-label="Change from last year, per cent" />
            </label>
            <Button type="button" variant="secondary" size="sm" disabled={fill.isPending} onClick={() => fill.mutate()}><Sparkles size={13} /> {fill.isPending ? 'Filling…' : 'Fill from last year'}</Button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="text-body text-ink-500">Add accounts above, or click Fill from last year to bring in every account with last year&apos;s figures.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line-200">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className="sticky left-0 bg-surface-sink px-2 py-2 text-left font-medium text-ink-500">Account (₹)</th>
                  {labels.map((l) => <th key={l} className="whitespace-nowrap px-1 py-2 text-right font-medium text-ink-500">{l}</th>)}
                  <th className="px-2 py-2 text-right font-medium text-ink-500">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const list = rows.filter((r) => typeOf(r.accountId) === s.type);
                  if (!list.length) return null;
                  const totals = columnTotals(s.type);
                  return [
                    <tr key={`${s.type}-head`} className="bg-surface-sink/60"><td colSpan={labels.length + 3} className="px-2 py-1 uppercase tracking-wide text-ink-500">{s.title.replace(' accounts', '')}</td></tr>,
                    ...list.map((r) => (
                      <tr key={r.accountId} className="border-b border-line-100">
                        <td className="sticky left-0 whitespace-nowrap bg-surface-card px-2 py-1 text-body text-ink-900">{nameOf(r.accountId)}</td>
                        {labels.map((l, i) => (
                          <td key={l} className="px-0.5 py-1">
                            <input className={cellClass} inputMode="decimal" aria-label={`${nameOf(r.accountId)} ${l}`} value={r.cells[i] ?? ''} onChange={(e) => setCell(r.accountId, i, e.target.value)} />
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-ink-900">{formatPaise(rowTotal(r))}</td>
                        <td className="px-1">
                          <button type="button" className="p-1 text-ink-400 hover:text-error-fg" aria-label={`Remove ${nameOf(r.accountId)}`} onClick={() => remove(r.accountId)}><X size={14} /></button>
                        </td>
                      </tr>
                    )),
                    <tr key={`${s.type}-total`} className="border-b border-line-200 font-medium">
                      <td className="sticky left-0 bg-surface-card px-2 py-1.5 text-ink-700">Total {s.title.replace(' accounts', '').toLowerCase()}</td>
                      {totals.map((t, i) => <td key={i} className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-ink-900">{formatPaise(t)}</td>)}
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-ink-900">{formatPaise(totals.reduce((a, b) => a + b, 0))}</td>
                      <td />
                    </tr>,
                    // The profit follows the income and expense sections, before any balance-sheet ones.
                    ...(s.type === 'EXPENSE' || (s.type === 'INCOME' && !rows.some((r) => typeOf(r.accountId) === 'EXPENSE'))
                      ? [profitRow]
                      : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-caption text-ink-500">
          A plan, not an entry: budgets never touch the books.
          {period !== 'monthly' && ' Each amount is split across its months to the paisa, the remainder on the last month, so budget against actual can read it month by month.'}
        </p>
      </Section>
    </FormPage>
  );
}
