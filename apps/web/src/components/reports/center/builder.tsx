'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Section } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { ReportTable, ReportTableView } from '@/components/reports/report-table-view';
import { FilterFields, PeriodFields, fieldClass, labelClass } from './report-params';
import type { CenterData, Condition, CustomSpec, Definition, ModuleInfo } from './types';
import { OP_LABEL, PERIODS, PERIOD_KEYS, defaultParams, toQuery } from './types';

const message = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** A column or field the builder offers: its key, label and kind. */
interface Choice {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'number' | 'pct' | 'date' | 'bool';
  ops: string[];
  options?: Array<[string, string]> | null;
  groupable: boolean;
}

const OPS_FOR: Record<Choice['kind'], string[]> = {
  text: ['contains', 'equals', 'not_equals'],
  date: ['equals', 'gt', 'gte', 'lt', 'lte'],
  money: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'],
  pct: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'],
  bool: ['is_true', 'is_false'],
};

export const EMPTY_SPEC: CustomSpec = {
  name: '', description: null, kind: 'derived', baseKey: null, module: null, params: {}, period: null, columns: [], conditions: [], groupBy: null, groupTotalsOnly: false, sortBy: null, sortDir: 'asc', shared: false,
};

/** Columns in the order shown, moved up and down; the rest to add. */
function ColumnPicker({ choices, value, onChange, keepFirst }: { choices: Choice[]; value: string[]; onChange: (v: string[]) => void; keepFirst?: string }) {
  const chosen = value.length ? value : choices.map((c) => c.key);
  const label = (k: string) => choices.find((c) => c.key === k)?.label ?? k;
  const move = (i: number, by: number) => {
    const next = [...chosen];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    onChange(next);
  };
  const rest = choices.filter((c) => !chosen.includes(c.key));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className={labelClass}>Shown, in this order</p>
        <ol className="divide-y divide-line-100 rounded-lg border border-line-200">
          {chosen.map((k, i) => (
            <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-body text-ink-900">
              <span className="w-5 font-mono text-caption tabular-nums text-ink-400">{i + 1}</span>
              <span className="flex-1">{label(k)}</span>
              <button type="button" aria-label={`Move ${label(k)} up`} disabled={i === 0} onClick={() => move(i, -1)} className="text-ink-400 hover:text-ink-900 disabled:opacity-30"><ArrowUp size={14} /></button>
              <button type="button" aria-label={`Move ${label(k)} down`} disabled={i === chosen.length - 1} onClick={() => move(i, 1)} className="text-ink-400 hover:text-ink-900 disabled:opacity-30"><ArrowDown size={14} /></button>
              <button type="button" aria-label={`Hide ${label(k)}`} disabled={chosen.length === 1 || k === keepFirst} onClick={() => onChange(chosen.filter((x) => x !== k))} className="text-ink-400 hover:text-error-fg disabled:opacity-30"><X size={14} /></button>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className={labelClass}>Add a column</p>
        {rest.length ? (
          <div className="flex flex-wrap gap-1.5">
            {rest.map((c) => (
              <button key={c.key} type="button" onClick={() => onChange([...chosen, c.key])} className="inline-flex items-center gap-1 rounded-full border border-line-200 bg-white px-2.5 py-1 text-caption text-ink-700 hover:border-saffron-600 hover:text-saffron-700">
                <Plus size={12} /> {c.label}
              </button>
            ))}
          </div>
        ) : <p className="text-caption text-ink-500">Every column is shown.</p>}
      </div>
    </div>
  );
}

/** Conditions on columns: text as typed, money in rupees (kept as paise), dates as dates. */
function ConditionsEditor({ choices, value, onChange }: { choices: Choice[]; value: Condition[]; onChange: (v: Condition[]) => void }) {
  const usable = choices.filter((c) => c.ops.length);
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {value.map((c, i) => {
        const field = usable.find((x) => x.key === c.field) ?? usable[0];
        const shown = field.kind === 'money' && typeof c.value === 'number' ? String(c.value / 100) : c.value ?? '';
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Column" className={fieldClass} value={field.key} onChange={(e) => { const f = usable.find((x) => x.key === e.target.value)!; set(i, { field: f.key, op: f.ops[0] as Condition['op'], value: f.kind === 'bool' ? null : f.kind === 'text' || f.kind === 'date' ? '' : 0 }); }}>
              {usable.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select aria-label="Condition" className={fieldClass} value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition['op'] })}>
              {field.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o] ?? o}</option>)}
            </select>
            {field.kind === 'bool' ? null : field.options ? (
              <select aria-label="Value" className={fieldClass} value={String(c.value ?? '')} onChange={(e) => set(i, { value: e.target.value })}>
                <option value="">Pick one</option>
                {field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input
                aria-label="Value"
                className={`${fieldClass} w-48 ${field.kind === 'money' || field.kind === 'number' || field.kind === 'pct' ? 'font-mono tabular-nums' : ''}`}
                type={field.kind === 'date' ? 'date' : field.kind === 'text' ? 'text' : 'number'}
                step={field.kind === 'money' ? '0.01' : 'any'}
                placeholder={field.kind === 'money' ? '₹ amount' : 'value'}
                value={shown}
                onChange={(e) => {
                  const v = e.target.value;
                  if (field.kind === 'money') set(i, { value: v === '' ? 0 : Math.round(Number(v) * 100) });
                  else if (field.kind === 'number' || field.kind === 'pct') set(i, { value: v === '' ? 0 : Number(v) });
                  else set(i, { value: v });
                }}
              />
            )}
            <button type="button" aria-label="Remove condition" onClick={() => onChange(value.filter((_, n) => n !== i))} className="text-ink-400 hover:text-error-fg"><X size={15} /></button>
          </div>
        );
      })}
      {usable.length > 0 && value.length < 10 && (
        <Button type="button" variant="secondary" size="sm" onClick={() => { const f = usable[0]; onChange([...value, { field: f.key, op: f.ops[0] as Condition['op'], value: f.kind === 'bool' ? null : f.kind === 'text' || f.kind === 'date' ? '' : 0 }]); }}>
          <Plus size={13} /> Add condition
        </Button>
      )}
    </div>
  );
}

type PeriodMode = 'default' | 'relative' | 'fixed';

/**
 * The report builder. `derived`: start from a built-in report, choose its
 * columns, filters, grouping and sorting. `module`: build from one module's
 * fields. Saved under My Reports; shared with the organisation if asked.
 */
export function ReportBuilder({ mode, initial, baseKey }: { mode: 'derived' | 'module'; initial?: CustomSpec | null; baseKey?: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [spec, setSpec] = useState<CustomSpec>(() => initial ?? { ...EMPTY_SPEC, kind: mode, baseKey: mode === 'derived' ? baseKey ?? null : null });
  const set = (patch: Partial<CustomSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const initialMode: PeriodMode = initial?.period ? 'relative' : initial && Object.keys(initial.params).some((k) => PERIOD_KEYS.includes(k)) ? 'fixed' : 'default';
  const [periodMode, setPeriodMode] = useState<PeriodMode>(initialMode);
  const [preview, setPreview] = useState<ReportTable | null>(null);

  // ── What the builder starts from ──
  const center = useQuery({ queryKey: ['reports', 'center'], queryFn: () => api.get<CenterData>('/reports/center'), enabled: mode === 'derived' });
  const builtIns = (center.data?.reports ?? []).filter((r) => !r.custom);
  const def = useQuery({ queryKey: ['reports', 'definition', spec.baseKey], queryFn: () => api.get<Definition>(`/reports/definition/${encodeURIComponent(spec.baseKey!)}`), enabled: mode === 'derived' && !!spec.baseKey });
  const sample = useQuery({
    queryKey: ['reports', 'run', spec.baseKey, 'columns', def.data?.params],
    queryFn: () => api.get<ReportTable>(`/reports/run/${encodeURIComponent(spec.baseKey!)}${toQuery({ ...defaultParams(def.data!.params), ...Object.fromEntries((def.data!.filters ?? []).filter((f) => f.required).map((f) => [f.key, spec.params[f.key]])) })}`),
    enabled: mode === 'derived' && !!def.data && !(def.data.filters ?? []).some((f) => f.required && !spec.params[f.key]),
  });
  const modules = useQuery({ queryKey: ['reports', 'modules'], queryFn: () => api.get<ModuleInfo[]>('/reports/modules'), enabled: mode === 'module' });
  const mod = modules.data?.find((m) => m.key === spec.module);

  const choices: Choice[] = useMemo(() => {
    if (mode === 'module') return (mod?.fields ?? []).map((f) => ({ key: f.key, label: f.label, kind: f.kind, ops: f.ops, options: f.options, groupable: f.groupable }));
    return (sample.data?.columns ?? []).map((c) => ({ key: c.key, label: c.label, kind: c.kind, ops: def.data?.shape === 'list' ? OPS_FOR[c.kind] : [], groupable: c.kind === 'text' }));
  }, [mode, mod, sample.data, def.data]);
  const isStatement = mode === 'derived' && def.data?.shape === 'statement';
  const paramKind = mode === 'derived' ? def.data?.params ?? 'range' : mod?.hasPeriod ? 'range' : 'today';

  // A module report starts with a handful of its fields.
  useEffect(() => {
    if (mode === 'module' && mod && !spec.columns.length) set({ columns: mod.fields.slice(0, Math.min(5, mod.fields.length)).map((f) => f.key) });
  }, [mode, mod]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixed = useMemo(() => Object.fromEntries(Object.entries(spec.params).filter(([k]) => PERIOD_KEYS.includes(k))), [spec.params]);
  const filterValues = useMemo(() => Object.fromEntries(Object.entries(spec.params).filter(([k]) => !PERIOD_KEYS.includes(k))), [spec.params]);
  const body = (): CustomSpec => ({
    ...spec,
    kind: mode,
    module: mode === 'module' ? spec.module : null,
    baseKey: mode === 'derived' ? spec.baseKey : null,
    period: periodMode === 'relative' ? spec.period ?? 'this_fy' : null,
    params: { ...filterValues, ...(periodMode === 'fixed' ? (Object.keys(fixed).length ? fixed : defaultParams(paramKind)) : {}) },
    columns: spec.columns,
    conditions: isStatement ? [] : spec.conditions,
    groupBy: isStatement ? null : spec.groupBy,
    sortBy: isStatement ? null : spec.sortBy,
  });
  const payload = () => {
    const b = body();
    return { name: b.name.trim(), description: b.description || null, kind: b.kind, baseKey: b.baseKey, module: b.module, params: b.params, period: b.period, columns: b.columns, conditions: b.conditions, groupBy: b.groupBy, groupTotalsOnly: b.groupTotalsOnly, sortBy: b.sortBy, sortDir: b.sortDir, shared: b.shared };
  };

  const runPreview = useMutation({
    mutationFn: () => api.post<ReportTable>('/reports/custom/preview', { ...payload(), name: payload().name || 'Preview' }),
    onSuccess: (t) => setPreview(t),
  });
  const save = useMutation({
    mutationFn: () => (initial?.id ? api.put<CustomSpec>(`/reports/custom/${initial.id}`, payload()) : api.post<CustomSpec>('/reports/custom', payload())),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['reports', 'center'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'definition', saved.key] });
      notify('Report saved');
      router.push(`/reports/view/${encodeURIComponent(saved.key!)}`);
    },
  });

  const ready = mode === 'derived' ? !!spec.baseKey && !!sample.data : !!mod && spec.columns.length > 0;
  const categories = [...new Set(builtIns.map((r) => r.categoryLabel))];

  return (
    <div className="space-y-5 pb-24">
      {mode === 'derived' ? (
        <Section title="1. Pick a report" description="Start from any built-in report. Its figures stay its own; you choose what it shows.">
          <select
            aria-label="Report to start from"
            className={`${fieldClass} w-full max-w-xl`}
            value={spec.baseKey ?? ''}
            onChange={(e) => { set({ baseKey: e.target.value || null, columns: [], conditions: [], groupBy: null, sortBy: null, params: {} }); setPreview(null); }}
          >
            <option value="">Pick a report…</option>
            {categories.map((c) => (
              <optgroup key={c} label={c}>
                {builtIns.filter((r) => r.categoryLabel === c).map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
              </optgroup>
            ))}
          </select>
          {def.data && <p className="mt-2 text-caption text-ink-500">{def.data.description} {isStatement ? 'A statement keeps its rows in order: choose its columns and period.' : 'A list: choose columns, filter rows, group and sort.'}</p>}
          {def.data && (def.data.filters ?? []).some((f) => f.required && !spec.params[f.key]) && (
            <div className="mt-3 flex flex-wrap gap-3"><FilterFields filters={def.data.filters.filter((f) => f.required)} value={filterValues} onChange={(v) => set({ params: { ...fixed, ...v } })} /></div>
          )}
          {sample.isLoading && <p className="mt-2 flex items-center gap-2 text-caption text-ink-400"><Loader2 size={13} className="animate-spin" /> Reading its columns…</p>}
          {sample.isError && <p className="mt-2 text-caption text-error-fg">{message(sample.error)}</p>}
        </Section>
      ) : (
        <Section title="1. Pick a module" description="Build a report from one kind of record. Only posted invoices, bills, expenses, payments and journal lines are read.">
          <div className="grid gap-2 sm:grid-cols-3">
            {(modules.data ?? []).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => { set({ module: m.key, columns: [], conditions: [], groupBy: null, sortBy: null }); setPreview(null); }}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${spec.module === m.key ? 'border-saffron-600 bg-honey-50' : 'border-line-200 bg-white hover:border-saffron-600/60'}`}
              >
                <p className="text-body font-medium text-ink-900">{m.label}</p>
                <p className="text-caption text-ink-500">{m.fields.length} fields{m.hasPeriod ? ' · by period' : ''}</p>
              </button>
            ))}
          </div>
          {modules.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={13} className="animate-spin" /> Loading modules…</p>}
        </Section>
      )}

      {ready && (
        <>
          <Section title={mode === 'derived' ? '2. Columns' : '2. Fields'} description="Choose what to show and in what order.">
            <ColumnPicker choices={choices} value={spec.columns} onChange={(columns) => set({ columns })} keepFirst={isStatement ? choices[0]?.key : undefined} />
          </Section>

          <Section title="3. Period and filters" description="The period it opens with. A relative period moves with the date, which suits a schedule.">
            <div className="flex flex-wrap items-end gap-3">
              {paramKind !== 'today' && (
                <div>
                  <label className={labelClass}>Period</label>
                  <select className={fieldClass} value={periodMode} onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}>
                    <option value="default">Choose when it is opened</option>
                    <option value="relative">Relative to the day it runs</option>
                    <option value="fixed">Fixed dates</option>
                  </select>
                </div>
              )}
              {periodMode === 'relative' && paramKind !== 'today' && (
                <div>
                  <label className={labelClass}>Covering</label>
                  <select className={fieldClass} value={spec.period ?? 'this_fy'} onChange={(e) => set({ period: e.target.value })}>
                    {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              {periodMode === 'fixed' && paramKind !== 'today' && (
                <PeriodFields kind={paramKind} value={Object.keys(fixed).length ? fixed : defaultParams(paramKind)} onChange={(v) => set({ params: { ...filterValues, ...v } })} />
              )}
              {mode === 'derived' && def.data && <FilterFields filters={def.data.filters} value={filterValues} onChange={(v) => set({ params: { ...fixed, ...v } })} />}
            </div>
          </Section>

          {!isStatement && (
            <Section title="4. Rows" description="Keep only the rows you want, group them with subtotals, and sort.">
              <div className="space-y-4">
                <div>
                  <p className={labelClass}>Show rows where</p>
                  <ConditionsEditor choices={choices} value={spec.conditions} onChange={(conditions) => set({ conditions })} />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className={labelClass}>Group by</label>
                    <select className={fieldClass} value={spec.groupBy ?? ''} onChange={(e) => set({ groupBy: e.target.value || null })}>
                      <option value="">No grouping</option>
                      {choices.filter((c) => c.groupable).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  {spec.groupBy && (
                    <label className="flex h-10 items-center gap-2 text-body text-ink-700">
                      <input type="checkbox" className="accent-saffron-600" checked={spec.groupTotalsOnly} onChange={(e) => set({ groupTotalsOnly: e.target.checked })} /> Show only the group totals
                    </label>
                  )}
                  <div>
                    <label className={labelClass}>Sort by</label>
                    <select className={fieldClass} value={spec.sortBy ?? ''} onChange={(e) => set({ sortBy: e.target.value || null })}>
                      <option value="">As the report orders it</option>
                      {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  {spec.sortBy && (
                    <select aria-label="Sort direction" className={fieldClass} value={spec.sortDir} onChange={(e) => set({ sortDir: e.target.value as 'asc' | 'desc' })}>
                      <option value="asc">Smallest or A first</option>
                      <option value="desc">Largest or Z first</option>
                    </select>
                  )}
                </div>
              </div>
            </Section>
          )}

          <Section title={isStatement ? '4. Name it' : '5. Name it'}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Report name" required><input className={`${fieldClass} w-full`} maxLength={120} placeholder="Sales to my top customers" value={spec.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Description"><input className={`${fieldClass} w-full`} maxLength={500} placeholder="What it is for" value={spec.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-body text-ink-700">
              <input type="checkbox" className="accent-saffron-600" checked={spec.shared} onChange={(e) => set({ shared: e.target.checked })} />
              Share with everyone in the organisation (Shared Reports). Otherwise only you see it, under My Reports.
            </label>
          </Section>

          {runPreview.isError && <p className="text-caption text-error-fg">{message(runPreview.error)}</p>}
          {preview && (
            <Section title="Preview" description={preview.subtitle}>
              <ReportTableView table={preview} compact />
            </Section>
          )}
        </>
      )}

      <div data-form-bar="" className="fixed bottom-0 left-[260px] right-0 z-30 border-t border-line-200 bg-surface-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-6 py-3">
          <Button type="button" disabled={!ready || spec.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            <Save size={14} /> {save.isPending ? 'Saving…' : 'Save report'}
          </Button>
          <Button type="button" variant="secondary" disabled={!ready || runPreview.isPending} onClick={() => runPreview.mutate()}>
            <Eye size={14} /> {runPreview.isPending ? 'Reading the books…' : 'Preview report'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
        </div>
      </div>
    </div>
  );
}
