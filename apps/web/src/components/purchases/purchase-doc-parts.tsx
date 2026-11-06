'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ListPlus, MapPin, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { th } from '@/components/page/page-shell';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { onSide, useItems, type ItemOption } from '@/components/items/item-picker';
import { ProjectSelect, useProjects } from '@/components/projects/project-select';
import { BulkItems } from '@/components/sales/sales-doc-parts';
import { stateName, useCustomers } from '@/components/sales/sales-data';
import { lineDiscountOf, type DiscountMode } from '@/components/sales/pricing';
import type { PartyAddress, PartyProfile } from '@/components/parties/party-profile';
import { GST_RATES, formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { bookableForBill } from './bill-lines';
import { formatMinor, parseMinor, useAccounts, useVendors, type Amounts, type VendorRecord } from './purchase-data';

/**
 * The parts every purchase document's form is built from: the vendor, the
 * delivery address, the discount switch and the item table. Purchase orders,
 * bills, recurring bills and vendor credits share them; the sales form's
 * number field, payment terms, totals and attachments are used as they are.
 * Nothing here decides a figure: the server prices the lines.
 */

export type Vendor = VendorRecord & PartyProfile;

/** The vendors, with their profile (payment terms, addresses), as one list. */
export function useVendorList() {
  const vendors = useVendors();
  return { ...vendors, list: (vendors.data ?? []) as Vendor[] };
}

// ── Vendor ──────────────────────────────────────────────────────────────────

/** "Select a vendor": a search over name, company, GSTIN and contact, with "+ New vendor" under it. */
export function VendorPicker({ value, onChange, id, newHref, invalid }: {
  value: string;
  onChange: (id: string) => void;
  id: string;
  /** Where "+ New vendor" goes: the vendor form, coming back here. Leave out where a new vendor makes no sense. */
  newHref?: string;
  invalid?: boolean;
}) {
  const vendors = useVendors();
  const list = (vendors.data ?? []) as Vendor[];
  const options: SearchOption[] = useMemo(
    () =>
      list.map((v) => {
        const company = v.companyName?.trim();
        return {
          value: v._id,
          label: company && company.toLowerCase() !== v.name.toLowerCase() ? `${v.name} · ${company}` : v.name,
          detail: v.gstin ?? undefined,
          keywords: [company, v.email, v.phone, v.gstin, v.pan].filter(Boolean).join(' '),
        };
      }),
    [list],
  );
  const chosen = list.find((v) => v._id === value);
  return (
    <div>
      <SearchSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        invalid={invalid}
        placeholder={vendors.isLoading ? 'Loading vendors…' : 'Select a vendor'}
        searchPlaceholder="Search name, company, GSTIN or phone"
        aria-label="Vendor"
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {newHref ? (
          <Link href={newHref} className="inline-flex items-center gap-1 text-caption font-medium text-saffron-700 hover:underline">
            <Plus size={12} /> New vendor
          </Link>
        ) : (
          <span />
        )}
        {chosen && (
          <p className="text-caption text-ink-500">
            {chosen.gstin ? <span className="font-mono">{chosen.gstin}</span> : 'Unregistered'}
            {' · '}
            {stateName(chosen.gstin?.slice(0, 2) ?? chosen.billingAddress?.stateCode ?? null) ?? 'No state'}
            {(chosen.outstandingPaise ?? 0) > 0 && (
              <>
                {' · '}we owe <span className="font-mono tabular-nums text-ink-700">{formatPaise(chosen.outstandingPaise ?? 0)}</span>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Addresses ───────────────────────────────────────────────────────────────

/** An address as lines: the ones filled in, the state by name. */
export function addressLines(a: Partial<PartyAddress> | null | undefined): string[] {
  if (!a) return [];
  const place = [a.city, a.pincode].filter((x) => x?.trim()).join(' ');
  const state = a.stateCode ? stateName(a.stateCode)?.replace(/\s*\(\d+\)$/, '') : null;
  return [a.attention, a.street1, a.street2, place, state].filter((x): x is string => !!x?.trim());
}

type DeliverTo = { kind: 'organisation' | 'customer'; customerId: string };

/**
 * Where the goods go: our own address (from Settings), or straight to a
 * customer's shipping address. The server keeps the address as it is when
 * the PO is raised.
 */
export function DeliverToField({ value, onChange, org }: {
  value: DeliverTo;
  onChange: (v: DeliverTo) => void;
  org: { name: string; address: string | null } | null;
}) {
  const customers = useCustomers();
  const [changing, setChanging] = useState(false);
  const list = (customers.data ?? []) as Array<{ _id: string; name: string; gstin: string | null; address?: string | null } & PartyProfile>;
  const customer = list.find((c) => c._id === value.customerId);
  const lines =
    value.kind === 'organisation'
      ? [org?.name ?? 'Your business', ...(org?.address ? org.address.split(/\n|,\s*/).filter(Boolean) : [])]
      : customer
        ? [customer.name, ...(addressLines(customer.shippingAddress).length ? addressLines(customer.shippingAddress) : addressLines(customer.billingAddress).length ? addressLines(customer.billingAddress) : customer.address ? [customer.address] : [])]
        : [];
  const noAddress = value.kind === 'organisation' ? !org?.address : !!customer && lines.length === 1;
  const options: SearchOption[] = list.map((c) => ({ value: c._id, label: c.name, detail: c.gstin ?? undefined }));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Deliver to">
        {(['organisation', 'customer'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-body text-ink-900">
            <input
              type="radio"
              name="deliver-to"
              className="h-4 w-4 accent-saffron-600"
              checked={value.kind === k}
              onChange={() => {
                onChange({ kind: k, customerId: k === 'customer' ? value.customerId : '' });
                setChanging(k === 'customer' && !value.customerId);
              }}
            />
            {k === 'organisation' ? 'Organisation' : 'Customer'}
          </label>
        ))}
      </div>
      {value.kind === 'customer' && (changing || !value.customerId) && (
        <SearchSelect
          value={value.customerId}
          onChange={(customerId) => {
            onChange({ kind: 'customer', customerId });
            setChanging(false);
          }}
          options={options}
          placeholder={customers.isLoading ? 'Loading customers…' : 'Choose the customer to deliver to'}
          searchPlaceholder="Search customers"
          aria-label="Customer to deliver to"
        />
      )}
      {lines.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-line-200 bg-white px-3 py-2.5">
          <MapPin size={14} className="mt-0.5 shrink-0 text-ink-400" />
          <address className="not-italic text-body leading-snug text-ink-700">
            <span className="font-medium text-ink-900">{lines[0]}</span>
            {lines.slice(1).map((l, i) => <span key={i} className="block text-caption text-ink-600">{l}</span>)}
            {noAddress && (
              <span className="block text-caption text-pending-fg">
                No address on file.{' '}
                {value.kind === 'organisation' ? <Link href="/settings" className="underline">Add it in Settings</Link> : <Link href={`/sales/customers/${value.customerId}/edit`} className="underline">Add a shipping address</Link>}
              </span>
            )}
          </address>
        </div>
      )}
      {value.kind === 'customer' && value.customerId && !changing && (
        <button type="button" className="text-caption font-medium text-saffron-700 hover:underline" onClick={() => setChanging(true)}>
          Change destination to deliver
        </button>
      )}
    </div>
  );
}

// ── Discount switch ─────────────────────────────────────────────────────────

export type DiscountLevel = 'transaction' | 'line';

/** "At transaction level" or "At line item level": where the discount is given. */
export function DiscountLevelSwitch({ value, onChange }: { value: DiscountLevel; onChange: (v: DiscountLevel) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-ink-500">Discount</span>
      <div className="flex overflow-hidden rounded-md border border-line-200" role="group" aria-label="Where the discount is given">
        {(['transaction', 'line'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn('px-2.5 py-1 text-caption font-medium', value === v ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-surface-sink')}
          >
            {v === 'transaction' ? 'At transaction level' : 'At line item level'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Lines ───────────────────────────────────────────────────────────────────

/** One line of a purchase document as it is typed: text until it is saved. */
export interface PurchaseLine {
  key: number;
  itemId: string;
  description: string;
  hsnSac: string;
  uqc: string;
  qty: string;
  /** Rupees; a foreign bill's own currency units. */
  rate: string;
  taxRatePct: number;
  /** The account it is booked to; empty for the item's, or Purchases. */
  accountId: string;
  /** Its own discount, when the discount is given line by line. */
  discountMode: DiscountMode;
  discount: string;
  /** The customer the cost is for, and whether it is billed on to them. */
  customerId: string;
  billable: boolean;
  projectId: string;
}

let nextKey = 1;
export const emptyPurchaseLine = (patch: Partial<PurchaseLine> = {}): PurchaseLine => ({
  key: nextKey++, itemId: '', description: '', hsnSac: '', uqc: '', qty: '1', rate: '', taxRatePct: 18, accountId: '', discountMode: 'percent', discount: '', customerId: '', billable: false, projectId: '', ...patch,
});
export const isBlankPurchaseLine = (l: PurchaseLine) => !l.description.trim() && !l.rate.trim() && !l.itemId;

const qtyOk = (q: number) => q > 0 && Math.round(q * 1000) === q * 1000;

/** What a line comes to before discount and tax: paise, or a foreign currency's minor units. Null when it cannot be read. */
export function purchaseLineGross(l: PurchaseLine, digits: number | null = null): number | null {
  const qty = Number(l.qty);
  const rate = digits === null ? parseRupees(l.rate || '0') : parseMinor(l.rate || '0', digits);
  if (rate === null || rate < 0 || !qtyOk(qty)) return null;
  return Math.round(qty * rate);
}

/** The lines checked as the server checks them; the first problem names its line. */
export function checkPurchaseLines(lines: PurchaseLine[], digits: number | null = null): string | null {
  const filled = lines.filter((l) => !isBlankPurchaseLine(l));
  if (filled.length === 0) return 'Add at least one line.';
  for (const [i, l] of filled.entries()) {
    const at = `Line ${i + 1}`;
    if (!l.description.trim()) return `${at} needs a description.`;
    if (!qtyOk(Number(l.qty))) return `${at}: the quantity is more than nothing, to three decimals at most.`;
    if (purchaseLineGross(l, digits) === null) return digits === null ? `${at}: the rate is an amount in rupees, like 1250.50.` : `${at}: the price is in the bill's currency, to ${digits} decimals at most.`;
    if (l.billable && !l.customerId) return `${at}: choose the customer to bill it on to.`;
  }
  return null;
}

/** A line as the API takes it: rupees to paise once, here (Invariant 1). Only what the form shows is sent. */
export function purchaseLineToApi(l: PurchaseLine, opts: { account?: boolean; lineDiscount?: boolean; customer?: boolean; project?: boolean } = {}) {
  const gross = purchaseLineGross(l) ?? 0;
  const d = opts.lineDiscount ? lineDiscountOf(gross, l.discountMode, l.discount) : null;
  return {
    description: l.description.trim(),
    ...(l.itemId ? { itemId: l.itemId } : {}),
    ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
    ...(l.uqc ? { uqc: l.uqc } : {}),
    qty: Number(l.qty),
    ratePaise: parseRupees(l.rate || '0') ?? 0,
    taxRatePct: l.taxRatePct,
    ...(opts.account && l.accountId ? { accountId: l.accountId } : {}),
    ...(d?.asked ? { discount: d.asked } : {}),
    ...(opts.customer && l.customerId ? { customerId: l.customerId, billable: l.billable } : {}),
    ...(opts.project && l.projectId ? { projectId: l.projectId } : {}),
  };
}

const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/** "Type or click to select an item": the items bought, searchable by name, code or HSN. */
function PurchaseItemPicker({ value, onPick }: { value: string; onPick: (item: ItemOption | null) => void }) {
  const { data, isLoading } = useItems();
  const items = useMemo(() => (data ?? []).filter((i) => i._id === value || (i.isActive && onSide(i, 'purchase'))), [data, value]);
  const options: SearchOption[] = useMemo(
    () => items.map((i) => ({ value: i._id, label: i.name, detail: i.hsnSac ?? undefined, keywords: [i.code, i.purchaseDescription, i.description].filter(Boolean).join(' ') })),
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

/** What a purchase line can be booked to, as a bill's can: an expense, or an asset bought. */
function AccountPicker({ value, onChange, fallback }: { value: string; onChange: (id: string) => void; fallback: string }) {
  const { data } = useAccounts();
  const options: SearchOption[] = useMemo(
    () =>
      (data ?? [])
        .filter((a) => bookableForBill(a) || a._id === value)
        .sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'EXPENSE' ? -1 : 1))
        .map((a) => ({ value: a._id, label: a.name, detail: a.code, group: a.type === 'EXPENSE' ? 'Expense' : 'Asset' })),
    [data, value],
  );
  return <SearchSelect value={value} onChange={onChange} options={options} noneLabel={fallback} placeholder={fallback} searchPlaceholder="Search accounts" aria-label="Account" className="text-caption" />;
}

/** The customer a cost is for, searchable. */
function CustomerCell({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const customers = useCustomers();
  const options: SearchOption[] = useMemo(() => (customers.data ?? []).map((c) => ({ value: c._id, label: c.name, detail: c.gstin ?? undefined })), [customers.data]);
  return <SearchSelect value={value} onChange={onChange} options={options} noneLabel="No customer" placeholder="Select customer" searchPlaceholder="Search customers" aria-label="Customer" className="text-caption" />;
}

/**
 * The item table of a purchase document: item details (with HSN/SAC),
 * account, quantity, rate, the line's own discount when given line by line,
 * GST, the customer the cost is for, and the amount. Add new row and Add
 * items in bulk. Picking an item fills its line with its purchase
 * description, cost price, HSN/SAC, GST and account; what is typed after stays.
 */
export function PurchaseLinesTable({ lines, onChange, foreign, showAccount = true, lineDiscount, showCustomer, showProject, noTax, shares }: {
  lines: PurchaseLine[];
  onChange: (lines: PurchaseLine[]) => void;
  /** A foreign bill: rates in its currency, no GST column, no account. */
  foreign?: { currency: string; digits: number } | null;
  showAccount?: boolean;
  /** The discount is given line by line: a discount column. */
  lineDiscount?: boolean;
  /** Bills: the customer each cost is for, and billable. */
  showCustomer?: boolean;
  showProject?: boolean;
  noTax?: boolean;
  /** Each line's discount, to show under its amount. */
  shares?: Map<number, number>;
}) {
  const [bulk, setBulk] = useState(false);
  const projects = useProjects();
  const withProject = !!showProject && (projects.data?.length ?? 0) > 0;
  const withAccount = showAccount && !foreign;
  const withDiscount = !!lineDiscount && !foreign;
  const withTax = !noTax && !foreign;
  const set = (key: number, patch: Partial<PurchaseLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const digits = foreign ? foreign.digits : null;
  const show = (v: number | null) => (v === null ? '—' : foreign ? formatMinor(v, foreign.currency, foreign.digits) : formatPaise(v));

  const fill = (item: ItemOption, l: PurchaseLine): Partial<PurchaseLine> => ({
    itemId: item._id,
    description: l.description.trim() ? l.description : item.purchaseDescription || item.name,
    hsnSac: item.hsnSac ?? l.hsnSac,
    uqc: item.uqc ?? '',
    taxRatePct: (GST_RATES as readonly number[]).includes(item.gstRatePct ?? -1) ? (item.gstRatePct as number) : l.taxRatePct,
    // The cost price fills an empty rate; one already typed stays. Rupees only.
    rate: !foreign && !l.rate.trim() && item.purchasePricePaise != null ? String(item.purchasePricePaise / 100) : l.rate,
    accountId: l.accountId || item.expenseAccountId || '',
  });

  const addItems = (picked: Array<{ item: ItemOption; qty: string }>) => {
    const added = picked.map(({ item, qty }) => {
      const blank = emptyPurchaseLine();
      return { ...blank, ...fill(item, blank), qty };
    });
    onChange([...lines.filter((l) => !isBlankPurchaseLine(l)), ...added]);
    setBulk(false);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-line-200">
        <table className={cn('w-full', withCustomerWidth(showCustomer, withDiscount))}>
          <thead>
            <tr className="border-b border-line-200 bg-surface-sink">
              <th className={`${th} w-8 text-right`}>#</th>
              <th className={th}>Item details</th>
              {withAccount && <th className={`${th} w-40`}>Account</th>}
              <th className={`${th} w-20 text-right`}>Quantity</th>
              <th className={`${th} w-28 text-right`}>{foreign ? `Rate (${foreign.currency})` : 'Rate (₹)'}</th>
              {withDiscount && <th className={`${th} w-32 text-right`}>Discount</th>}
              {withTax && <th className={`${th} w-20`}>Tax</th>}
              {showCustomer && <th className={`${th} w-44`}>{withProject ? 'Customer and project' : 'Customer details'}</th>}
              {withProject && !showCustomer && <th className={`${th} w-40`}>Project</th>}
              <th className={`${th} w-32 text-right`}>Amount</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const gross = isBlankPurchaseLine(l) ? null : purchaseLineGross(l, digits);
              const share = shares?.get(l.key) ?? 0;
              const own = withDiscount ? lineDiscountOf(gross ?? 0, l.discountMode, l.discount) : null;
              return (
                <tr key={l.key} className="border-b border-line-100 align-top last:border-0">
                  <td className="px-2 pt-3 text-right font-mono text-caption tabular-nums text-ink-400">{i + 1}</td>
                  <td className="space-y-1.5 px-1.5 py-2">
                    <PurchaseItemPicker value={l.itemId} onPick={(item) => set(l.key, item ? fill(item, l) : { itemId: '' })} />
                    <textarea
                      className={`${cell} min-h-[38px] resize-y`}
                      rows={1}
                      maxLength={500}
                      placeholder="Description: what was bought"
                      value={l.description}
                      onChange={(e) => set(l.key, { description: e.target.value })}
                      aria-label={`Line ${i + 1} description`}
                    />
                    <input
                      className={`${cell} w-32 font-mono`}
                      inputMode="numeric"
                      placeholder="HSN/SAC"
                      value={l.hsnSac}
                      onChange={(e) => set(l.key, { hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                      aria-label={`Line ${i + 1} HSN/SAC`}
                    />
                  </td>
                  {withAccount && (
                    <td className="px-1.5 py-2">
                      <AccountPicker value={l.accountId} onChange={(accountId) => set(l.key, { accountId })} fallback={l.itemId ? 'The item’s account' : 'Purchases'} />
                    </td>
                  )}
                  <td className="px-1.5 py-2">
                    <input className={`${cell} text-right font-mono tabular-nums`} inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                    {l.uqc && <p className="mt-0.5 text-right font-mono text-[0.6875rem] text-ink-400">{l.uqc}</p>}
                  </td>
                  <td className="px-1.5 py-2">
                    <input className={`${cell} text-right font-mono tabular-nums`} inputMode="decimal" placeholder="0.00" value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} aria-label={`Line ${i + 1} rate`} />
                  </td>
                  {withDiscount && (
                    <td className="px-1.5 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          className={cn(cell, 'text-right font-mono tabular-nums', own?.problem && 'border-error-fg')}
                          inputMode="decimal"
                          placeholder="0"
                          value={l.discount}
                          onChange={(e) => set(l.key, { discount: e.target.value })}
                          aria-label={`Line ${i + 1} discount ${l.discountMode === 'percent' ? 'percent' : 'in rupees'}`}
                        />
                        <div className="flex shrink-0 overflow-hidden rounded-md border border-line-200" role="group" aria-label={`Line ${i + 1} discount as`}>
                          {(['percent', 'amount'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => set(l.key, { discountMode: m })}
                              aria-pressed={l.discountMode === m}
                              className={cn('px-1.5 py-1 text-[0.6875rem] font-medium', l.discountMode === m ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-surface-sink')}
                            >
                              {m === 'percent' ? '%' : '₹'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {own?.problem && <p className="mt-0.5 text-right text-[0.6875rem] text-error-fg">{own.problem}</p>}
                    </td>
                  )}
                  {withTax && (
                    <td className="px-1.5 py-2">
                      <select className={cell} value={l.taxRatePct} onChange={(e) => set(l.key, { taxRatePct: Number(e.target.value) })} aria-label={`Line ${i + 1} GST rate`}>
                        {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                  )}
                  {showCustomer && (
                    <td className="space-y-1.5 px-1.5 py-2">
                      <CustomerCell value={l.customerId} onChange={(customerId) => set(l.key, { customerId, billable: !!customerId })} />
                      <label className={cn('flex items-center gap-1.5 text-caption', l.customerId ? 'text-ink-700' : 'text-ink-400')}>
                        <input type="checkbox" className="h-3.5 w-3.5 accent-saffron-600" disabled={!l.customerId} checked={l.billable} onChange={(e) => set(l.key, { billable: e.target.checked })} />
                        Billable
                      </label>
                      {withProject && <ProjectSelect className={cell} value={l.projectId} onChange={(projectId) => set(l.key, { projectId })} />}
                    </td>
                  )}
                  {withProject && !showCustomer && (
                    <td className="px-1.5 py-2">
                      <ProjectSelect className={cell} value={l.projectId} onChange={(projectId) => set(l.key, { projectId })} />
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
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, emptyPurchaseLine()])}>
          <Plus size={13} /> Add new row
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setBulk((b) => !b)} aria-expanded={bulk}>
          <ListPlus size={13} /> Add items in bulk
        </Button>
      </div>
      {bulk && <BulkItems side="purchase" onAdd={addItems} onClose={() => setBulk(false)} />}
    </div>
  );
}

/** The table's least width: wider with the customer and discount columns, so nothing is squeezed. */
function withCustomerWidth(customer?: boolean, discount?: boolean) {
  return customer && discount ? 'min-w-[1080px]' : customer || discount ? 'min-w-[980px]' : 'min-w-[860px]';
}

// ── A saved document's figures ──────────────────────────────────────────────

/**
 * Sub total, discount, taxable value, the tax heads, the adjustment and the
 * total of a saved PO, bill or vendor credit: the server's figures, shown.
 */
export function DocTotalsSummary({ amounts, lines, discount, discountLevel, adjustment, note }: {
  amounts: Amounts;
  lines: Array<{ amountPaise: number }>;
  discount?: { percent: number | null; amountPaise: number } | null;
  discountLevel?: 'transaction' | 'line' | null;
  adjustment?: { label: string; paise: number } | null;
  note?: React.ReactNode;
}) {
  const row = (label: React.ReactNode, value: string, strong = false) => (
    <div className={cn('flex justify-between gap-6 py-1', strong ? 'mt-1 border-t border-line-200 pt-2 font-semibold text-ink-900' : 'text-ink-600')}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
  const subTotal = lines.reduce((s, l) => s + l.amountPaise, 0);
  const discounted = !!discount && discount.amountPaise > 0;
  const adj = adjustment?.paise ?? 0;
  return (
    <div className="ml-auto w-full max-w-sm text-body">
      {discounted && row('Sub total', formatPaise(subTotal))}
      {discounted && row(discountLevel === 'line' ? 'Discount (on the lines)' : discount!.percent ? `Discount (${discount!.percent}%)` : 'Discount', `− ${formatPaise(discount!.amountPaise)}`)}
      {row(discounted ? 'Taxable value' : 'Before tax', formatPaise(amounts.taxableValue))}
      {amounts.cgst > 0 && row('CGST', formatPaise(amounts.cgst))}
      {amounts.sgst > 0 && row('SGST', formatPaise(amounts.sgst))}
      {amounts.igst > 0 && row('IGST', formatPaise(amounts.igst))}
      {amounts.cess > 0 && row('Cess', formatPaise(amounts.cess))}
      {adj !== 0 && row(adjustment?.label || 'Adjustment', adj < 0 ? `− ${formatPaise(-adj)}` : formatPaise(adj))}
      {row('Total', formatPaise(amounts.total), true)}
      {note && <p className="mt-1 text-caption text-ink-500">{note}</p>}
    </div>
  );
}
