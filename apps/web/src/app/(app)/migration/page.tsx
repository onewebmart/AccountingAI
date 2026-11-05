'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CheckCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { currentFinancialYear } from '@/lib/financial-year';
import { formatRupees } from '@/lib/utils';
import { ManualOpeningForm } from '@/components/migration/manual-opening-form';
import { GuideButton } from '@/components/guide/module-guide';

// ── Shapes from /migration (paise; debit positive) ──────────────────────────

type AccountGroup = 'current_assets' | 'fixed_assets' | 'liabilities' | 'capital' | 'income' | 'direct_expenses' | 'indirect_expenses';

interface ImportedAccount {
  name: string;
  code: string | null;
  classification: { type: string; group: AccountGroup; role: string | null } | null;
  sourceType: string | null;
  balancePaise: number;
}

interface ImportedParty {
  name: string;
  kind: 'customer' | 'vendor';
  gstin: string | null;
  email: string | null;
  balancePaise: number;
}

interface ImportView {
  _id: string;
  source: 'tally' | 'zoho' | 'quickbooks' | 'spreadsheet' | 'manual';
  fileNames: string[];
  status: 'previewed' | 'committing' | 'committed';
  accounts: ImportedAccount[];
  parties: ImportedParty[];
  warnings: string[];
  unplaced: string[];
  opening: { debitPaise: number; creditPaise: number; differencePaise: number };
  openingDate: string | null;
  result: {
    accountsCreated: number;
    accountsMatched: number;
    customersCreated: number;
    vendorsCreated: number;
    partiesMatched: number;
    documentsCreated: number;
  } | null;
  lastError: string | null;
}

const SOURCE: Record<ImportView['source'], string> = { tally: 'Tally', zoho: 'Zoho Books', quickbooks: 'QuickBooks', spreadsheet: 'Spreadsheet', manual: 'Entered by hand' };

const GROUPS: Array<{ value: AccountGroup; label: string }> = [
  { value: 'current_assets', label: 'Current asset' },
  { value: 'fixed_assets', label: 'Fixed asset' },
  { value: 'liabilities', label: 'Liability' },
  { value: 'capital', label: 'Capital' },
  { value: 'income', label: 'Income' },
  { value: 'direct_expenses', label: 'Direct expense' },
  { value: 'indirect_expenses', label: 'Indirect expense' },
];

/** Accounts that land on one of our own ledgers. */
const ROLE_LABEL: Record<string, string> = {
  bank: 'Bank', cash: 'Cash', receivable: 'Receivables', payable: 'Payables', retained_earnings: 'Retained earnings', suspense: 'Suspense',
  tds_payable: 'TDS payable', tds_receivable: 'TDS receivable',
  gst_output_cgst: 'Output CGST', gst_output_sgst: 'Output SGST', gst_output_igst: 'Output IGST', gst_output_cess: 'Output cess',
  gst_input_cgst: 'Input CGST', gst_input_sgst: 'Input SGST', gst_input_igst: 'Input IGST', gst_input_cess: 'Input cess',
};

function what(a: ImportedAccount): string {
  const role = a.classification?.role;
  if (role) return ROLE_LABEL[role] ?? role;
  return GROUPS.find((g) => g.value === a.classification?.group)?.label ?? '';
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

function DrCr({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-ink-400">—</span>;
  return (
    <span className="font-mono">
      {formatRupees(Math.abs(paise))} <span className="text-caption text-ink-500">{paise > 0 ? 'Dr' : 'Cr'}</span>
    </span>
  );
}

/**
 * Moving books in from Tally, Zoho Books or QuickBooks: read the exports,
 * look at what would come in, then bring the masters and opening balances
 * over in one go.
 */
export default function MigrationPage() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [view, setView] = useState<ImportView | null>(null);
  const [groups, setGroups] = useState<Record<string, AccountGroup>>({});
  const [openingDate, setOpeningDate] = useState(`${currentFinancialYear().slice(0, 4)}-04-01`);
  const [toSuspense, setToSuspense] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'import' | 'manual'>('import');

  const history = useQuery<Array<{ _id: string; source: ImportView['source']; fileNames: string[]; status: string; openingDate: string | null; createdAt: string }>>({
    queryKey: ['migration'],
    queryFn: () => api.get('/migration'),
  });

  const preview = useMutation({
    mutationFn: () => {
      const body = new FormData();
      files.forEach((f) => body.append('files', f));
      return api.post<ImportView>('/migration/preview', body);
    },
    onSuccess: (v) => {
      setView(v);
      setGroups({});
      setToSuspense(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['migration'] });
    },
    onError: (err) => setError(message(err, "Couldn't read those files.")),
  });

  const commit = useMutation({
    mutationFn: () =>
      api.post<ImportView>(`/migration/${view!._id}/commit`, { openingDate, groups, differenceToSuspense: toSuspense }),
    onSuccess: (v) => {
      setView(v);
      setError(null);
      void queryClient.invalidateQueries();
    },
    onError: (err) => setError(message(err, "Couldn't import the opening balances.")),
  });

  const stillUnplaced = view ? view.unplaced.filter((n) => !groups[n]) : [];
  const out = view?.opening.differencePaise ?? 0;
  const committed = view?.status === 'committed';

  return (
    <div className="max-w-[1100px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Opening balances</h1>
          <p className="text-body text-ink-500 mt-1">
            Bring the chart of accounts, customers, vendors and opening balances over from Tally, Zoho Books or QuickBooks, or type the balances in.
          </p>
        </div>
        <GuideButton guide="openingBalances" />
      </div>

      <div className="inline-flex rounded-md border border-line-200 bg-surface-card p-1">
        {(
          [
            ['import', 'Import from another system'],
            ['manual', 'Enter by hand'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setView(null);
              setError(null);
            }}
            className={`rounded px-3 py-1.5 text-body font-medium ${mode === value ? 'bg-honey-50 text-saffron-700' : 'text-ink-600 hover:text-ink-900'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'manual' && !view && (
        <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
          <h2 className="text-body font-semibold text-ink-900">1. Enter the balances</h2>
          <ManualOpeningForm
            onPreview={(v) => {
              setView(v as ImportView);
              setGroups({});
              setToSuspense(false);
              void queryClient.invalidateQueries({ queryKey: ['migration'] });
            }}
            onError={setError}
          />
        </section>
      )}

      {/* Step 1: files */}
      {mode === 'import' && (
      <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
        <h2 className="text-body font-semibold text-ink-900">1. Upload the exports</h2>
        <ul className="list-disc space-y-0.5 pl-5 text-caption text-ink-500">
          <li><span className="font-medium text-ink-700">Tally:</span> Gateway of Tally → Export → Masters, as XML (All Masters).</li>
          <li><span className="font-medium text-ink-700">Zoho Books:</span> the Trial Balance report, Chart of Accounts and Contacts, as CSV or Excel.</li>
          <li><span className="font-medium text-ink-700">QuickBooks:</span> the Trial Balance, Account List and Customer and Vendor Balance Summaries.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-line-200 bg-surface-card px-4 py-2 text-body font-medium text-ink-900 hover:bg-surface-sink">
            <Upload size={14} /> Choose files
            <input
              type="file"
              multiple
              accept=".xml,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
          {files.length > 0 && <span className="text-caption text-ink-700">{files.map((f) => f.name).join(', ')}</span>}
          <Button disabled={files.length === 0 || preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending ? 'Reading…' : 'Read the files'}
          </Button>
        </div>
      </section>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-error-fg/30 bg-error-bg px-4 py-3 text-body text-error-fg">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {view && (
        <>
          {/* Step 2: what came in */}
          <section className="space-y-4 rounded-lg border border-line-200 bg-surface-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-body font-semibold text-ink-900">2. Check {view.source === 'manual' ? 'the balances' : <>what was read — from {SOURCE[view.source]}</>}</h2>
              <p className="text-caption text-ink-500">
                {view.accounts.length} accounts · {view.parties.filter((p) => p.kind === 'customer').length} customers ·{' '}
                {view.parties.filter((p) => p.kind === 'vendor').length} vendors
              </p>
            </div>

            {view.warnings.length > 0 && (
              <div className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3">
                <p className="mb-1 flex items-center gap-2 text-body font-semibold text-pending-fg"><AlertTriangle size={14} /> Worth a look</p>
                <ul className="list-disc space-y-0.5 pl-5 text-caption text-ink-900">
                  {view.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="max-h-[420px] overflow-auto rounded-md border border-line-200">
              <table className="w-full text-body">
                <thead className="sticky top-0 bg-surface-sink">
                  <tr>
                    {['Account', 'In the other system', 'Here it is', 'Opening balance'].map((h, i) => (
                      <th key={h} className={`px-3 py-2 text-caption font-medium text-ink-500 ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-100">
                  {view.accounts.map((a) => (
                    <tr key={a.name}>
                      <td className="px-3 py-2 text-ink-900">{a.name}{a.code && <span className="ml-2 font-mono text-caption text-ink-500">{a.code}</span>}</td>
                      <td className="px-3 py-2 text-caption text-ink-500">{a.sourceType ?? '—'}</td>
                      <td className="px-3 py-2 text-caption">
                        {a.classification ? (
                          <span className="text-ink-700">{what(a)}</span>
                        ) : (
                          <select
                            disabled={committed}
                            value={groups[a.name] ?? ''}
                            onChange={(e) => setGroups((g) => ({ ...g, [a.name]: e.target.value as AccountGroup }))}
                            className={`rounded border px-2 py-1 ${a.balancePaise !== 0 && !groups[a.name] ? 'border-error-fg text-error-fg' : 'border-line-200 text-ink-900'}`}
                          >
                            <option value="">What is this?</option>
                            {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right"><DrCr paise={a.balancePaise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {view.parties.length > 0 && (
              <div className="max-h-[320px] overflow-auto rounded-md border border-line-200">
                <table className="w-full text-body">
                  <thead className="sticky top-0 bg-surface-sink">
                    <tr>
                      {['Customer or vendor', 'GSTIN', 'Owed'].map((h, i) => (
                        <th key={h} className={`px-3 py-2 text-caption font-medium text-ink-500 ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-100">
                    {view.parties.map((p) => (
                      <tr key={`${p.kind}-${p.name}`}>
                        <td className="px-3 py-2 text-ink-900">
                          {p.name} <span className="text-caption text-ink-500">{p.kind}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-caption text-ink-700">{p.gstin ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {p.balancePaise === 0 ? <span className="text-ink-400">—</span> : (
                            <>
                              {formatRupees(Math.abs(p.balancePaise))}
                              <span className="ml-1 text-caption text-ink-500">
                                {p.balancePaise > 0 ? (p.kind === 'customer' ? 'they owe' : 'we owe') : 'advance'}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap gap-6 rounded-md bg-surface-sink px-4 py-3 text-body">
              <span>Debits <span className="font-mono font-semibold">{formatRupees(view.opening.debitPaise)}</span></span>
              <span>Credits <span className="font-mono font-semibold">{formatRupees(view.opening.creditPaise)}</span></span>
              <span className={out === 0 ? 'text-success-fg' : 'text-error-fg'}>
                {out === 0 ? 'Balanced' : `Out by ${formatRupees(Math.abs(out))} ${out > 0 ? 'Dr' : 'Cr'}`}
              </span>
            </div>
          </section>

          {/* Step 3: commit */}
          <section className="space-y-4 rounded-lg border border-line-200 bg-surface-card p-5">
            <h2 className="text-body font-semibold text-ink-900">3. Bring it over</h2>
            {committed && view.result ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-body font-semibold text-success-fg">
                  <CheckCircle size={16} /> Imported, with opening balances as at {view.openingDate}
                </p>
                <p className="text-body text-ink-700">
                  {view.result.accountsCreated} accounts added ({view.result.accountsMatched} already here) · {view.result.customersCreated} customers
                  and {view.result.vendorsCreated} vendors added ({view.result.partiesMatched} already here) · {view.result.documentsCreated} opening
                  balances to collect or pay.
                </p>
                <p className="text-caption text-ink-500">
                  See them on <Link href="/accountant/chart-of-accounts" className="text-brand-600 hover:underline">Chart of accounts</Link>,{' '}
                  <Link href="/sales/invoices" className="text-brand-600 hover:underline">Invoices</Link> and{' '}
                  <Link href="/purchases/bills" className="text-brand-600 hover:underline">Bills</Link>. Reversing the opening voucher undoes the balances.
                </p>
              </div>
            ) : (
              <>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-caption font-medium text-ink-700">Balances as at</span>
                  <input
                    type="date"
                    value={openingDate}
                    onChange={(e) => setOpeningDate(e.target.value)}
                    className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="mt-1 block text-caption text-ink-500">Usually 1 April, or the day you start keeping books here.</span>
                </label>
                {out !== 0 && (
                  <label className="flex items-start gap-2 text-body text-ink-700">
                    <input type="checkbox" className="mt-1" checked={toSuspense} onChange={(e) => setToSuspense(e.target.checked)} />
                    Post the {formatRupees(Math.abs(out))} difference to Suspense and sort it out later
                  </label>
                )}
                <Button
                  disabled={commit.isPending || stillUnplaced.length > 0 || (out !== 0 && !toSuspense)}
                  onClick={() => commit.mutate()}
                  title={stillUnplaced.length ? `Say what ${stillUnplaced.join(', ')} ${stillUnplaced.length === 1 ? 'is' : 'are'} first` : undefined}
                >
                  {commit.isPending ? 'Importing…' : 'Import opening balances'}
                </Button>
              </>
            )}
          </section>
        </>
      )}

      {(history.data ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink-900">Earlier imports</h2>
          <ul className="divide-y divide-line-100 rounded-lg border border-line-200 bg-surface-card">
            {history.data!.map((h) => (
              <li key={h._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-body">
                <span className="text-ink-900">{SOURCE[h.source]} · <span className="text-caption text-ink-500">{h.fileNames.join(', ')}</span></span>
                <span className={`text-caption ${h.status === 'committed' ? 'text-success-fg' : 'text-pending-fg'}`}>
                  {h.status === 'committed' ? `Imported, as at ${h.openingDate}` : 'Read, not imported'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
