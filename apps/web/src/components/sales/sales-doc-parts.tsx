'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ListPlus, Paperclip, Plus, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, inputClass, th } from '@/components/page/page-shell';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { onSide, useItems, type ItemOption } from '@/components/items/item-picker';
import { useAccounts } from '@/components/accountant/common';
import { PAYMENT_TERMS } from '@/components/parties/party-profile';
import { api } from '@/lib/api';
import { GST_RATES, formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatMinor, stateName, toMinor, useCustomers, type CustomerRow } from './sales-data';
import { ADJUSTMENT_LIMIT_PAISE, type DiscountMode, type Pricing } from './pricing';

/**
 * The parts every sales document's form is built from: the customer, the
 * number, the lines, the totals and the footer. Laid out like a full sales
 * document; money in mono, figures previewed here and worked out on the
 * server when the document is saved.
 */

// ── Customer ────────────────────────────────────────────────────────────────

type Customer = CustomerRow & { companyName?: string | null };

/** "Select or add a customer": a search over name, company, GSTIN and contact, with "+ New customer" under it. */
export function CustomerPicker({ value, onChange, id, newHref, invalid }: {
  value: string;
  onChange: (id: string) => void;
  id: string;
  /** Where "+ New customer" goes: the customer form, coming back here. */
  newHref: string;
  invalid?: boolean;
}) {
  const customers = useCustomers();
  const options: SearchOption[] = useMemo(
    () =>
      ((customers.data ?? []) as Customer[]).map((c) => {
        const company = c.companyName?.trim();
        return {
          value: c._id,
          label: company && company.toLowerCase() !== c.name.toLowerCase() ? `${c.name} · ${company}` : c.name,
          detail: c.gstin ?? undefined,
          keywords: [company, c.email, c.phone, c.gstin].filter(Boolean).join(' '),
        };
      }),
    [customers.data],
  );
  const chosen = (customers.data ?? []).find((c) => c._id === value) as Customer | undefined;
  return (
    <div>
      <SearchSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        invalid={invalid}
        placeholder={customers.isLoading ? 'Loading customers…' : 'Select or add a customer'}
        searchPlaceholder="Search name, company, GSTIN or phone"
        aria-label="Customer"
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link href={newHref} className="inline-flex items-center gap-1 text-caption font-medium text-saffron-700 hover:underline">
          <Plus size={12} /> New customer
        </Link>
        {chosen && (
          <p className="text-caption text-ink-500">
            {chosen.gstin ? '' : 'Unregistered · '}
            {stateName(chosen.stateCode ?? chosen.gstin?.slice(0, 2) ?? null) ?? 'No state'}
            {chosen.receivablePaise > 0 && (
              <>
                {' · '}owes <span className="font-mono tabular-nums text-ink-700">{formatPaise(chosen.receivablePaise)}</span>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Number ──────────────────────────────────────────────────────────────────

/**
 * The document's number: automatic unless the person opens the cog and types
 * their own. Up to 16 letters, digits, "/" and "-", as GST asks.
 */
export function NumberField({ label, value, onChange, own, onOwn, autoText, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  own: boolean;
  onOwn: (own: boolean) => void;
  /** What shows while it is automatic: "QT/2026-27/next". */
  autoText: string;
  hint?: string;
}) {
  return (
    <Field label={label} required hint={own ? 'Up to 16 letters, digits, "/" and "-". Checked unused when you save.' : hint}>
      <div className="flex gap-1.5">
        {own ? (
          <input
            className={`${inputClass} font-mono`}
            maxLength={16}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9/-]/g, ''))}
            placeholder="Your number"
            autoFocus
          />
        ) : (
          <input className={`${inputClass} font-mono text-ink-500`} value={autoText} readOnly tabIndex={-1} aria-label={`${label}, automatic`} />
        )}
        <button
          type="button"
          className={cn('shrink-0 rounded-md border px-2.5 text-ink-500 hover:text-ink-900', own ? 'border-saffron-600 bg-honey-50' : 'border-line-200 bg-white')}
          onClick={() => {
            if (own) onChange('');
            onOwn(!own);
          }}
          title={own ? 'Number it automatically' : 'Type your own number'}
          aria-label={own ? 'Number it automatically' : 'Type your own number'}
          aria-pressed={own}
        >
          <Settings2 size={15} />
        </button>
      </div>
    </Field>
  );
}

// ── Payment terms ───────────────────────────────────────────────────────────

/** The days a term gives, when it is a number of days: due on receipt is 0, net 30 is 30; month-end terms are not. */
export function termsDays(code: string): number | null {
  if (code === 'due_on_receipt') return 0;
  const net = /^net_(\d+)$/.exec(code);
  return net ? Number(net[1]) : null;
}

/** A number of days as a term: 0 is due on receipt, 30 is net 30. */
export const daysTerms = (days: number | null | undefined) => (days == null ? '' : days === 0 ? 'due_on_receipt' : `net_${days}`);

/**
 * Payment terms, as customers carry them (due on receipt, net 7 to 90, end
 * of the month): a common term, or any number of days, held as net_<days>.
 * Month-end terms only where a due date can be given (invoices).
 */
export function PaymentTermsField({ value, onChange, allowNone = true, monthEnd = false, label = 'Payment terms', hint }: {
  value: string;
  onChange: (terms: string) => void;
  allowNone?: boolean;
  monthEnd?: boolean;
  label?: string;
  hint?: React.ReactNode;
}) {
  const options = PAYMENT_TERMS.filter(([v]) => monthEnd || termsDays(v) !== null);
  const known = value === '' || options.some(([v]) => v === value);
  const [custom, setCustom] = useState(!known);
  return (
    <Field label={label} hint={custom ? 'Days after the date, 0 to 365.' : hint}>
      <div className="flex gap-1.5">
        <select
          className={inputClass}
          value={custom ? 'custom' : value}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(e.target.value);
          }}
        >
          {allowNone && <option value="">None</option>}
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="custom">Custom days</option>
        </select>
        {custom && (
          <input
            className={`${inputClass} w-24 font-mono`}
            inputMode="numeric"
            value={termsDays(value) ?? ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
              onChange(digits === '' ? '' : daysTerms(Math.min(365, Number(digits))));
            }}
            aria-label="Days"
            placeholder="Days"
          />
        )}
      </div>
    </Field>
  );
}

// ── Salesperson ─────────────────────────────────────────────────────────────

/** The org the person is signed in to, read from the session token, so suggestions stay with it. */
function orgKey(): string {
  try {
    const token = localStorage.getItem('access_token') ?? '';
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { orgId?: string };
    return payload.orgId ?? 'org';
  } catch {
    return 'org';
  }
}

export function salespeople(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(`aibooks:salespeople:${orgKey()}`) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Remember a salesperson's name for this org's next document. */
export function rememberSalesperson(name: string) {
  const n = name.trim();
  if (!n || typeof window === 'undefined') return;
  const list = [n, ...salespeople().filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 30);
  localStorage.setItem(`aibooks:salespeople:${orgKey()}`, JSON.stringify(list));
}

/** A name, typed or picked from those used before. */
export function SalespersonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [known] = useState(salespeople);
  return (
    <Field label="Salesperson">
      <input className={inputClass} list="aibooks-salespeople" maxLength={80} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select or type a name" />
      <datalist id="aibooks-salespeople">
        {known.map((n) => <option key={n} value={n} />)}
      </datalist>
    </Field>
  );
}

// ── Lines ───────────────────────────────────────────────────────────────────

/** One line as it is typed: text until it is saved, so nothing is rounded under the person's fingers. */
export interface SaleLine {
  key: number;
  itemId: string;
  description: string;
  hsnSac: string;
  uqc: string;
  qty: string;
  /** Rupees; a foreign currency's own units on an export invoice. */
  rate: string;
  taxRatePct: number;
  /** Credit notes: the income account the line comes back off. */
  accountId: string;
}

let nextKey = 1;
export const emptySaleLine = (patch: Partial<SaleLine> = {}): SaleLine => ({ key: nextKey++, itemId: '', description: '', hsnSac: '', uqc: '', qty: '1', rate: '', taxRatePct: 18, accountId: '', ...patch });
export const isBlankLine = (l: SaleLine) => !l.description.trim() && !l.rate.trim() && !l.itemId;

/** In rupees, or in a foreign currency's minor units with its digits. */
export type LineMoney = { kind: 'inr' } | { kind: 'foreign'; currency: string; digits: number };

const qtyOk = (q: number) => q > 0 && Math.round(q * 1000) === q * 1000;

/** What a line comes to before discount and tax: paise, or minor units. Null when it cannot be read. */
export function lineGross(l: SaleLine, money: LineMoney = { kind: 'inr' }): number | null {
  const qty = Number(l.qty);
  const rate = money.kind === 'inr' ? parseRupees(l.rate || '0') : toMinor(l.rate || '0', money.digits);
  if (rate === null || rate < 0 || !qtyOk(qty)) return null;
  return Math.round(qty * rate);
}

/** The lines checked as the server checks them; the first problem names its line. */
export function checkLines(lines: SaleLine[], money: LineMoney = { kind: 'inr' }): string | null {
  const filled = lines.filter((l) => !isBlankLine(l));
  if (filled.length === 0) return 'Add at least one line.';
  for (const [i, l] of filled.entries()) {
    const at = `Line ${i + 1}`;
    if (!l.description.trim()) return `${at} needs a description.`;
    if (!qtyOk(Number(l.qty))) return `${at}: the quantity is more than nothing, to three decimals at most.`;
    if (lineGross(l, money) === null) return money.kind === 'inr' ? `${at}: the rate is an amount in rupees, like 1250.50.` : `${at}: the price is an amount in ${money.currency}, to ${money.digits} decimals at most.`;
  }
  return null;
}

const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/** "Type or click to select an item": the items sold, searchable by name, code or HSN. */
export function SaleItemPicker({ value, onPick }: { value: string; onPick: (item: ItemOption | null) => void }) {
  const { data, isLoading } = useItems();
  const items = useMemo(() => (data ?? []).filter((i) => i._id === value || (i.isActive && onSide(i, 'sale'))), [data, value]);
  const options: SearchOption[] = useMemo(
    () => items.map((i) => ({ value: i._id, label: i.name, detail: i.hsnSac ?? undefined, keywords: [i.code, i.description].filter(Boolean).join(' ') })),
    [items],
  );
  return (
    <SearchSelect
      value={value}
      onChange={(id) => onPick(items.find((i) => i._id === id) ?? null)}
      options={options}
      noneLabel="No item: type the line"
      placeholder={isLoading ? 'Loading items…' : 'Type or click to select an item'}
      searchPlaceholder="Search items"
      aria-label="Item"
      className="text-caption"
    />
  );
}

/** Income accounts a credit note line can come back off, searchable. */
function IncomeAccountPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useAccounts();
  const options: SearchOption[] = useMemo(
    () => (data ?? []).filter((a) => a.type === 'INCOME' && !a.isGroup && (a.isActive || a._id === value)).map((a) => ({ value: a._id, label: a.name, detail: a.code })),
    [data, value],
  );
  return <SearchSelect value={value} onChange={onChange} options={options} placeholder="Sales" searchPlaceholder="Search income accounts" aria-label="Account" className="text-caption" />;
}

/** The Sales account's id, the default a credit note line comes back off. */
export function useSalesAccountId(): string {
  const { data } = useAccounts();
  return (data ?? []).find((a) => a.systemKey === 'SALES_REVENUE')?._id ?? '';
}

/**
 * The item table: item details, HSN/SAC, quantity, rate, GST and amount, with
 * Add new row and Add items in bulk. Picking an item fills its line, and this
 * customer's last price fills the rate; what the person changes stays changed.
 */
export function SaleLinesTable({ lines, onChange, customerId, money = { kind: 'inr' }, showAccount, noTax, shares }: {
  lines: SaleLine[];
  onChange: (lines: SaleLine[]) => void;
  customerId: string;
  money?: LineMoney;
  /** Credit notes: an income account per line. */
  showAccount?: boolean;
  /** An export: no GST column. */
  noTax?: boolean;
  /** Each line's share of the discount, to show beside its amount. */
  shares?: Map<number, number>;
}) {
  const [bulk, setBulk] = useState(false);
  const salesAccount = useSalesAccountId();
  const foreign = money.kind === 'foreign';
  const set = (key: number, patch: Partial<SaleLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const show = (v: number | null) => (v === null ? '—' : money.kind === 'inr' ? formatPaise(v) : formatMinor(v, money.currency, money.digits));

  const fill = (item: ItemOption, l: SaleLine): Partial<SaleLine> => ({
    itemId: item._id,
    description: item.name,
    hsnSac: item.hsnSac ?? l.hsnSac,
    uqc: item.uqc ?? '',
    taxRatePct: (GST_RATES as readonly number[]).includes(item.gstRatePct ?? -1) ? (item.gstRatePct as number) : l.taxRatePct,
    rate: !foreign && item.salePricePaise != null ? String(item.salePricePaise / 100) : l.rate,
    ...(showAccount ? { accountId: item.incomeAccountId ?? salesAccount } : {}),
  });

  const pick = async (l: SaleLine, item: ItemOption | null) => {
    if (!item) return set(l.key, { itemId: '' });
    const filled = fill(item, l);
    set(l.key, filled);
    // This customer's last price beats the list price, in rupees only.
    if (customerId && !foreign) {
      const price = await api.get<{ ratePaise: number } | null>(`/orders/price?customerId=${customerId}&itemId=${item._id}`).catch(() => null);
      if (price) onChange(lines.map((x) => (x.key === l.key ? { ...x, ...filled, rate: String(price.ratePaise / 100) } : x)));
    }
  };

  const addItems = (picked: Array<{ item: ItemOption; qty: string }>) => {
    const added = picked.map(({ item, qty }) => {
      const blank = emptySaleLine();
      return { ...blank, ...fill(item, blank), qty };
    });
    onChange([...lines.filter((l) => !isBlankLine(l)), ...added]);
    setBulk(false);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-line-200">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="border-b border-line-200 bg-surface-sink">
              <th className={`${th} w-8 text-right`}>#</th>
              <th className={th}>Item details</th>
              <th className={`${th} w-28`}>HSN/SAC</th>
              {showAccount && <th className={`${th} w-48`}>Account</th>}
              <th className={`${th} w-24 text-right`}>Quantity</th>
              <th className={`${th} w-32 text-right`}>{foreign ? `Price (${money.currency})` : 'Rate (₹)'}</th>
              {!noTax && <th className={`${th} w-24`}>GST</th>}
              <th className={`${th} w-36 text-right`}>Amount</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const gross = isBlankLine(l) ? null : lineGross(l, money);
              const share = shares?.get(l.key) ?? 0;
              return (
                <tr key={l.key} className="border-b border-line-100 align-top last:border-0">
                  <td className="px-2 pt-3 text-right font-mono text-caption tabular-nums text-ink-400">{i + 1}</td>
                  <td className="space-y-1.5 px-1.5 py-2">
                    <SaleItemPicker value={l.itemId} onPick={(item) => void pick(l, item)} />
                    <textarea
                      className={`${cell} min-h-[38px] resize-y`}
                      rows={1}
                      maxLength={500}
                      placeholder="Description: what was sold"
                      value={l.description}
                      onChange={(e) => set(l.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-1.5 py-2">
                    <input className={`${cell} font-mono`} inputMode="numeric" placeholder="998314" value={l.hsnSac} onChange={(e) => set(l.key, { hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) })} aria-label={`Line ${i + 1} HSN/SAC`} />
                  </td>
                  {showAccount && (
                    <td className="px-1.5 py-2">
                      <IncomeAccountPicker value={l.accountId || salesAccount} onChange={(accountId) => set(l.key, { accountId })} />
                    </td>
                  )}
                  <td className="px-1.5 py-2">
                    <input className={`${cell} text-right font-mono tabular-nums`} inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                    {l.uqc && <p className="mt-0.5 text-right font-mono text-[0.6875rem] text-ink-400">{l.uqc}</p>}
                  </td>
                  <td className="px-1.5 py-2">
                    <input className={`${cell} text-right font-mono tabular-nums`} inputMode="decimal" placeholder="0.00" value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} aria-label={`Line ${i + 1} rate`} />
                  </td>
                  {!noTax && (
                    <td className="px-1.5 py-2">
                      <select className={cell} value={l.taxRatePct} onChange={(e) => set(l.key, { taxRatePct: Number(e.target.value) })} aria-label={`Line ${i + 1} GST rate`}>
                        {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-2 text-right">
                    <p className="pt-1.5 font-mono text-body tabular-nums text-ink-900">{show(gross)}</p>
                    {share > 0 && <p className="font-mono text-[0.6875rem] tabular-nums text-ink-500">less {formatPaise(share)}</p>}
                  </td>
                  <td className="py-2 pr-2 text-center">
                    <button
                      type="button"
                      className="mt-2 text-ink-400 hover:text-error-fg disabled:opacity-30"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                    >
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, emptySaleLine()])}>
          <Plus size={13} /> Add new row
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setBulk((b) => !b)} aria-expanded={bulk}>
          <ListPlus size={13} /> Add items in bulk
        </Button>
      </div>
      {bulk && <BulkItems onAdd={addItems} onClose={() => setBulk(false)} />}
    </div>
  );
}

/** Tick several items and their quantities, and add them as lines at once: the items sold, or on a purchase the items bought. */
export function BulkItems({ onAdd, onClose, side = 'sale' }: { onAdd: (picked: Array<{ item: ItemOption; qty: string }>) => void; onClose: () => void; side?: 'sale' | 'purchase' }) {
  const { data, isLoading } = useItems();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const items = (data ?? []).filter((i) => i.isActive && onSide(i, side));
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => !q || [i.name, i.code, i.hsnSac, i.description].some((v) => v?.toLowerCase().includes(q))).slice(0, 100);
  const toggle = (id: string) =>
    setChosen((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else n.set(id, '1');
      return n;
    });
  const picked = [...chosen.entries()].flatMap(([id, qty]) => {
    const item = items.find((i) => i._id === id);
    return item && Number(qty) > 0 ? [{ item, qty }] : [];
  });
  return (
    <div className="rounded-lg border border-line-200 bg-surface-sink p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-medium text-ink-900">Add items in bulk</p>
        <input className={`${inputClass} max-w-xs`} placeholder="Search items" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search items" />
      </div>
      {isLoading ? (
        <p className="text-caption text-ink-400">Loading items…</p>
      ) : items.length === 0 ? (
        <p className="text-caption text-ink-500">
          No items yet. <Link href="/items/new" className="underline">Add an item</Link>, or type each line.
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-line-100 overflow-y-auto rounded-md border border-line-200 bg-white">
          {shown.map((i) => {
            const on = chosen.has(i._id);
            return (
              <li key={i._id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={on} onChange={() => toggle(i._id)} id={`bulk-${i._id}`} className="h-4 w-4 accent-saffron-600" />
                <label htmlFor={`bulk-${i._id}`} className="min-w-0 flex-1 cursor-pointer text-body text-ink-900">
                  {i.name}
                  {i.hsnSac && <span className="ml-2 font-mono text-caption text-ink-400">{i.hsnSac}</span>}
                </label>
                <span className="font-mono text-caption tabular-nums text-ink-500">{(side === 'sale' ? i.salePricePaise : i.purchasePricePaise) != null ? formatPaise((side === 'sale' ? i.salePricePaise : i.purchasePricePaise)!) : '—'}</span>
                <input
                  className="w-20 rounded-md border border-line-200 px-2 py-1 text-right font-mono text-caption tabular-nums disabled:bg-surface-sink"
                  inputMode="decimal"
                  disabled={!on}
                  value={chosen.get(i._id) ?? ''}
                  onChange={(e) => setChosen((m) => new Map(m).set(i._id, e.target.value))}
                  aria-label={`Quantity of ${i.name}`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
          {picked.length ? `Add ${picked.length} item${picked.length === 1 ? '' : 's'}` : 'Add items'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

// ── Totals ──────────────────────────────────────────────────────────────────

function Row({ label, children, strong, sub }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean; sub?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5', strong && 'mt-1 border-t border-line-200 pt-3', sub && 'text-ink-500')}>
      <dt className={cn('text-body', strong ? 'font-semibold text-ink-900' : 'text-ink-600')}>{label}</dt>
      <dd className={cn('text-right font-mono tabular-nums', strong ? 'text-h3 font-semibold text-ink-900' : 'text-body text-ink-900')}>{children}</dd>
    </div>
  );
}

/**
 * Sub total, discount (a percent or rupees), the tax heads, the adjustment
 * and the total, previewed as the server will work them out.
 */
export function TotalsPanel({ pricing, interState, discount, adjustment, foreignTotal, noTax, supplyNote }: {
  pricing: Pricing;
  interState: boolean;
  /** Omitted where a document takes no discount (a challan). */
  discount?: { mode: DiscountMode; value: string; onMode: (m: DiscountMode) => void; onValue: (v: string) => void };
  /** Omitted where a document takes no adjustment. */
  adjustment?: { label: string; value: string; onLabel: (v: string) => void; onValue: (v: string) => void; caption?: string };
  /** An export: its total in its own currency, no GST. */
  foreignTotal?: React.ReactNode;
  noTax?: boolean;
  supplyNote?: React.ReactNode;
}) {
  const a = pricing.amounts;
  if (foreignTotal) {
    return <dl>{foreignTotal}</dl>;
  }
  return (
    <div>
      <dl>
        <Row label="Sub total">{formatPaise(pricing.subTotalPaise)}</Row>
        {discount && (
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body text-ink-600">Discount</dt>
              <div className="flex items-center gap-1.5">
                <input
                  className={cn('w-24 rounded-md border bg-white px-2 py-1.5 text-right font-mono text-caption tabular-nums focus:outline-none focus:ring-2 focus:ring-saffron-600/40', pricing.discountProblem ? 'border-error-fg' : 'border-line-200')}
                  inputMode="decimal"
                  value={discount.value}
                  onChange={(e) => discount.onValue(e.target.value)}
                  placeholder="0"
                  aria-label={discount.mode === 'percent' ? 'Discount percent' : 'Discount in rupees'}
                />
                <div className="flex overflow-hidden rounded-md border border-line-200" role="group" aria-label="Discount as">
                  {(['percent', 'amount'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => discount.onMode(m)}
                      aria-pressed={discount.mode === m}
                      className={cn('px-2 py-1 text-caption font-medium', discount.mode === m ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-surface-sink')}
                    >
                      {m === 'percent' ? '%' : '₹'}
                    </button>
                  ))}
                </div>
                <dd className="w-28 text-right font-mono text-body tabular-nums text-ink-900">{pricing.discountPaise ? `− ${formatPaise(pricing.discountPaise)}` : formatPaise(0)}</dd>
              </div>
            </div>
            {pricing.discountProblem ? (
              <p className="mt-1 text-right text-caption text-error-fg">{pricing.discountProblem}</p>
            ) : (
              <p className="mt-1 text-right text-caption text-ink-400">Before tax: GST is on the value after the discount.</p>
            )}
          </div>
        )}
        {/* A discount given line by line (on a bill): what the lines' discounts come to. */}
        {!discount && pricing.discountPaise > 0 && <Row label="Discount (on the lines)">− {formatPaise(pricing.discountPaise)}</Row>}
        {pricing.discountPaise > 0 && <Row label="Taxable value">{formatPaise(a.taxableValue)}</Row>}
        {!noTax &&
          (interState ? (
            <Row label="IGST">{formatPaise(a.igst)}</Row>
          ) : (
            <>
              <Row label="CGST">{formatPaise(a.cgst)}</Row>
              <Row label="SGST">{formatPaise(a.sgst)}</Row>
            </>
          ))}
        {adjustment && (
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-3">
              <input
                className="w-32 rounded-md border border-dashed border-line-200 bg-white px-2 py-1.5 text-body text-ink-700 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
                maxLength={40}
                value={adjustment.label}
                onChange={(e) => adjustment.onLabel(e.target.value)}
                aria-label="What the adjustment is called"
              />
              <div className="flex items-center gap-1.5">
                <input
                  className={cn('w-24 rounded-md border bg-white px-2 py-1.5 text-right font-mono text-caption tabular-nums focus:outline-none focus:ring-2 focus:ring-saffron-600/40', pricing.adjustmentProblem ? 'border-error-fg' : 'border-line-200')}
                  inputMode="decimal"
                  value={adjustment.value}
                  onChange={(e) => adjustment.onValue(e.target.value)}
                  placeholder="0.00"
                  aria-label="Adjustment in rupees, minus to take off"
                />
                <dd className="w-28 text-right font-mono text-body tabular-nums text-ink-900">{pricing.adjustmentPaise < 0 ? `− ${formatPaise(-pricing.adjustmentPaise)}` : formatPaise(pricing.adjustmentPaise)}</dd>
              </div>
            </div>
            {pricing.adjustmentProblem ? (
              <p className="mt-1 text-right text-caption text-error-fg">{pricing.adjustmentProblem}</p>
            ) : (
              <p className="mt-1 text-right text-caption text-ink-400">
                {adjustment.caption ?? `After tax, for rounding: up to ${formatPaise(ADJUSTMENT_LIMIT_PAISE)} either way, minus to take off. Not taxed.`}
              </p>
            )}
          </div>
        )}
        <Row label="Total (₹)" strong>{formatPaise(a.total)}</Row>
      </dl>
      {supplyNote && <p className="mt-3 text-caption text-ink-500">{supplyNote}</p>}
      <p className="mt-2 text-caption text-ink-400">A preview: the server works the figures out again when you save.</p>
    </div>
  );
}

// ── Attachments ─────────────────────────────────────────────────────────────

/** Files chosen on the form, kept with the document once it is saved. */
export function AttachFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-line-200 bg-white px-3 py-2 text-caption font-medium text-ink-700 hover:bg-surface-sink">
        <Paperclip size={13} /> Attach files
        <input
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv,.doc,.docx,.txt,.zip"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            onChange([...files, ...picked].slice(0, 5));
          }}
        />
      </label>
      <p className="mt-1 text-caption text-ink-400">Up to 5 files, 15 MB each. Kept with the document when you save.</p>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-surface-sink px-2.5 py-1.5 text-caption">
              <span className="min-w-0 truncate font-mono text-ink-700">{f.name}</span>
              <button type="button" className="text-ink-400 hover:text-error-fg" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, n) => n !== i))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Upload the chosen files against the saved record. Returns the names that could not be kept. */
export async function uploadFiles(entityType: string, entityId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files) {
    const body = new FormData();
    body.append('entityType', entityType);
    body.append('entityId', entityId);
    body.append('file', file);
    try {
      await api.post('/attachments', body);
    } catch {
      failed.push(file.name);
    }
  }
  return failed;
}
