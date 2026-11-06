'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FilterDef, ParamKind } from './types';
import { recentYears } from './types';

export const fieldClass = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
export const labelClass = 'mb-1 block text-caption font-medium text-ink-700';

/** The period controls a report takes: months, a year, a date, a month or a quarter. */
export function PeriodFields({ kind, value, onChange }: { kind: ParamKind; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const set = (patch: Record<string, string>) => onChange({ ...value, ...patch });
  if (kind === 'today') return <p className="self-center text-caption text-ink-500">As the books stand today.</p>;
  if (kind === 'range')
    return (
      <>
        <div><label className={labelClass}>From</label><input type="month" className={fieldClass} value={value.from ?? ''} onChange={(e) => e.target.value && set({ from: e.target.value })} /></div>
        <div><label className={labelClass}>To</label><input type="month" className={fieldClass} value={value.to ?? ''} onChange={(e) => e.target.value && set({ to: e.target.value })} /></div>
      </>
    );
  if (kind === 'month')
    return <div><label className={labelClass}>Month</label><input type="month" className={fieldClass} value={value.to ?? ''} onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value })} /></div>;
  if (kind === 'asof')
    return <div><label className={labelClass}>As at</label><input type="date" className={fieldClass} value={value.asOf ?? ''} onChange={(e) => e.target.value && set({ asOf: e.target.value })} /></div>;
  const year = (
    <div>
      <label className={labelClass}>Financial year</label>
      <select className={fieldClass} value={value.financialYear ?? ''} onChange={(e) => set({ financialYear: e.target.value })}>
        {recentYears().map((y) => <option key={y} value={y}>FY {y}</option>)}
      </select>
    </div>
  );
  if (kind === 'year') return year;
  return (
    <>
      {year}
      <div>
        <label className={labelClass}>Quarter</label>
        <select className={fieldClass} value={value.quarter ?? 'Q1'} onChange={(e) => set({ quarter: e.target.value })}>
          {[['Q1', 'Q1 · Apr–Jun'], ['Q2', 'Q2 · Jul–Sep'], ['Q3', 'Q3 · Oct–Dec'], ['Q4', 'Q4 · Jan–Mar']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    </>
  );
}

function FilterSelect({ f, value, onChange }: { f: FilterDef; value: string; onChange: (v: string) => void }) {
  const list = useQuery({
    queryKey: ['reports', 'options', f.kind],
    queryFn: () => api.get<Array<{ value: string; label: string }>>(`/reports/options/${f.kind}`),
    enabled: f.kind !== 'select',
    staleTime: 60_000,
  });
  const options: Array<[string, string]> = f.kind === 'select' ? f.options ?? [] : (list.data ?? []).map((o) => [o.value, o.label]);
  return (
    <div>
      <label className={labelClass}>{f.label}{f.required && <span className="text-error-fg"> *</span>}</label>
      <select className={`${fieldClass} max-w-[16rem]`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.required ? `Pick the ${f.label.toLowerCase()}` : f.empty ?? 'All'}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/** A report's own filters: a customer, an account, a status. */
export function FilterFields({ filters, value, onChange }: { filters: FilterDef[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <>
      {filters.map((f) => (
        <FilterSelect key={f.key} f={f} value={value[f.key] ?? ''} onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
    </>
  );
}
