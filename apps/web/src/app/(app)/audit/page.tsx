'use client';

import { Fragment, useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

// ── Shapes from GET /audit and /audit/facets ────────────────────────────────

interface AuditRow {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string; name: string; kind: 'user' | 'system' };
  impersonatedBy: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

interface Facets {
  entityTypes: string[];
  actions: string[];
  actors: Array<{ id: string; name: string; kind: 'user' | 'system' }>;
}

interface Filters {
  entityType: string;
  entityId: string;
  actorId: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { entityType: '', entityId: '', actorId: '', action: '', from: '', to: '' };

/** What each record type is called on screen. */
const RECORD: Record<string, string> = {
  SalesInvoice: 'Invoice',
  PurchaseBill: 'Bill',
  Journal: 'Voucher',
  Customer: 'Customer',
  Vendor: 'Vendor',
  LedgerAccount: 'Account',
  BankAccount: 'Bank account',
  BankStatement: 'Bank statement',
  BankStatementLine: 'Bank line',
  CreditNote: 'Credit note',
  DebitNote: 'Debit note',
  TdsDeposit: 'TDS deposit',
  ProposedEntry: 'Proposed entry',
  ImportBatch: 'Books import',
  BankFeedConsent: 'Bank feed',
  RecurringTemplate: 'Recurring schedule',
  OrgSettings: 'Settings',
  PeriodLock: 'Period lock',
};

const recordName = (type: string) => RECORD[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2');
const actionName = (action: string) => action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, ' ');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** A changed value as a person reads it: paise as rupees, nothing as a dash. */
function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && /Paise$/.test(key)) return formatRupees(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Changes({ row }: { row: AuditRow }) {
  const keys = [...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})])];
  const meta = Object.entries(row.meta ?? {}).filter(([k]) => k !== 'impersonatedBy');
  if (keys.length === 0 && meta.length === 0) return <p className="text-caption text-ink-400">No field details were recorded for this change.</p>;
  return (
    <div className="space-y-2">
      {keys.length > 0 && (
        <table className="w-full text-caption">
          <thead>
            <tr className="text-left text-ink-500">
              <th className="py-1 pr-3 font-medium">Field</th>
              <th className="py-1 pr-3 font-medium">Before</th>
              <th className="py-1 font-medium">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-100">
            {keys.map((k) => (
              <tr key={k}>
                <td className="py-1 pr-3 font-mono text-ink-600">{k}</td>
                <td className="py-1 pr-3 font-mono text-ink-500 break-all">{show(k, row.before?.[k])}</td>
                <td className="py-1 font-mono text-ink-900 break-all">{show(k, row.after?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {meta.length > 0 && (
        <p className="text-caption text-ink-500">
          {meta.map(([k, v]) => `${k}: ${show(k, v)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * Who changed what, and when, across the books. Read-only: an audit trail
 * that could be edited would prove nothing.
 */
export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [open, setOpen] = useState<string | null>(null);

  // A record's "History" link arrives with ?entityType=…&entityId=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = { ...EMPTY };
    (Object.keys(EMPTY) as Array<keyof Filters>).forEach((k) => {
      fromUrl[k] = params.get(k) ?? '';
    });
    if (Object.values(fromUrl).some(Boolean)) setFilters(fromUrl);
  }, []);

  const facets = useQuery<Facets>({ queryKey: ['audit', 'facets'], queryFn: () => api.get<Facets>('/audit/facets') });
  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
      if (pageParam) params.set('before', pageParam);
      return api.get<{ entries: AuditRow[]; next: string | null }>(`/audit?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const rows = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const select = 'rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-h1 font-display text-ink-900">
          <ShieldCheck size={24} className="text-ink-500" /> Audit trail
        </h1>
        <p className="text-body text-ink-500 mt-1">Every change to your books: who made it, when, and what it was before. Nothing here can be edited.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line-200 bg-surface-card p-4">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Record</span>
          <select className={select} value={filters.entityType} onChange={set('entityType')}>
            <option value="">All records</option>
            {(facets.data?.entityTypes ?? []).map((t) => (
              <option key={t} value={t}>
                {recordName(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Person</span>
          <select className={select} value={filters.actorId} onChange={set('actorId')}>
            <option value="">Everyone</option>
            {(facets.data?.actors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Action</span>
          <select className={select} value={filters.action} onChange={set('action')}>
            <option value="">Any action</option>
            {(facets.data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {actionName(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">From</span>
          <input type="date" className={select} value={filters.from} onChange={set('from')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">To</span>
          <input type="date" className={select} value={filters.to} onChange={set('to')} />
        </label>
        {filtered && (
          <button type="button" className="pb-2 text-caption font-medium text-ink-500 hover:text-ink-900" onClick={() => setFilters(EMPTY)}>
            Clear filters
          </button>
        )}
      </div>
      {filters.entityId && (
        <p className="text-caption text-ink-500">
          Showing the history of one {filters.entityType ? recordName(filters.entityType).toLowerCase() : 'record'}{' '}
          <span className="font-mono">{filters.entityId}</span>.
        </p>
      )}

      {query.isError ? (
        <div className="rounded-lg border border-line-200 bg-surface-card">
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-200 bg-surface-card">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line-200 text-left">
                {['When', 'Who', 'What', 'Record'].map((h) => (
                  <th key={h} className="px-4 py-2 text-caption font-medium text-ink-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {query.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-caption text-ink-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!query.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-caption text-ink-400">
                    {filtered ? 'Nothing matches these filters.' : 'No changes recorded yet.'}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="cursor-pointer hover:bg-surface-sink/60" onClick={() => setOpen(open === row.id ? null : row.id)}>
                    <td className="whitespace-nowrap px-4 py-2 text-caption text-ink-600">
                      <span className="inline-flex items-center gap-1">
                        {open === row.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        {when(row.at)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={row.actor.kind === 'system' ? 'text-ink-500' : 'text-ink-900'}>{row.actor.name}</span>
                      {row.impersonatedBy && (
                        <span className="ml-2 rounded-full bg-pending-bg px-2 py-0.5 text-caption text-pending-fg">via {row.impersonatedBy}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-900">{actionName(row.action)}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        className="text-left text-ink-700 hover:text-ink-900 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilters({ ...EMPTY, entityType: row.entityType, entityId: row.entityId });
                        }}
                        title="Show this record's history"
                      >
                        {recordName(row.entityType)} <span className="font-mono text-caption text-ink-400">…{row.entityId.slice(-6)}</span>
                      </button>
                    </td>
                  </tr>
                  {open === row.id && (
                    <tr>
                      <td colSpan={4} className="bg-surface-sink/50 px-6 py-3">
                        <Changes row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? 'Loading…' : 'Show older changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
