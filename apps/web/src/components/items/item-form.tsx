'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { errorText, useAccounts, type Account } from '@/components/accountant/common';
import { useVendors } from '@/components/purchases/purchase-data';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ItemOption } from './item-picker';
import { UNITS } from './units';

const RATES = [0, 3, 5, 12, 18, 28, 40];

type Kind = 'goods' | 'service';

interface Suggestion {
  hsnSac: string;
  kind: Kind;
  gstRatePct: number | null;
  uqc: string;
  reason: string;
  source: 'history' | 'rule' | 'model';
  confidence: number;
}

interface SuggestionView {
  id: string | null;
  status: 'done' | 'queued' | 'none' | 'failed';
  suggestion: Suggestion | null;
  message: string | null;
}

type HsnSource = { by: Suggestion['source']; reason: string | null; confidence: number | null };

export const SOURCE_LABEL: Record<Suggestion['source'], string> = {
  history: 'from your past invoices and bills',
  rule: 'from a rule',
  model: 'from AI',
};

interface Form {
  name: string;
  code: string;
  kind: Kind;
  /** The unit for goods; a service's is NA and is not kept here. */
  uqc: string;
  hsnSac: string;
  gstRatePct: string;
  forSale: boolean;
  /** Rupees, as typed. */
  sale: string;
  /** Empty until the person picks one: the default for the kind shows instead. */
  incomeAccountId: string;
  description: string;
  forPurchase: boolean;
  purchase: string;
  expenseAccountId: string;
  purchaseDescription: string;
  preferredVendorId: string;
  trackStock: boolean;
  reorderLevel: string;
  reorderQty: string;
}

const rupees = (paise: number | null | undefined) => (paise == null ? '' : (paise / 100).toFixed(2).replace(/\.00$/, ''));
const qtyText = (n: number | null | undefined) => (n == null ? '' : String(n));

const fromItem = (item?: ItemOption | null): Form => ({
  name: item?.name ?? '',
  code: item?.code ?? '',
  kind: item?.kind ?? 'goods',
  uqc: item && item.uqc && item.uqc !== 'NA' ? item.uqc : 'NOS',
  hsnSac: item?.hsnSac ?? '',
  gstRatePct: item?.gstRatePct == null ? '' : String(item.gstRatePct),
  forSale: item?.forSale !== false,
  sale: rupees(item?.salePricePaise),
  incomeAccountId: item?.incomeAccountId ?? '',
  description: item?.description ?? '',
  forPurchase: item?.forPurchase !== false,
  purchase: rupees(item?.purchasePricePaise),
  expenseAccountId: item?.expenseAccountId ?? '',
  purchaseDescription: item?.purchaseDescription ?? '',
  preferredVendorId: item?.preferredVendorId ?? '',
  trackStock: item?.trackStock !== false,
  reorderLevel: qtyText(item?.reorderLevel),
  reorderQty: qtyText(item?.reorderQty),
});

/** Names a chart may give the income account for services. */
const SERVICE_INCOME = /^(services? (revenue|income|sales)|income from services?|sales? of services?)$/i;
/** Asset ledgers that hold money, not things bought: never a purchase account. */
const MONEY_NAME = /\b(bank|cash|petty|wallet|imprest|current a\/?c|savings a\/?c)\b/i;
const TYPE_LABEL: Record<string, string> = { ASSETS: 'Assets', LIABILITIES: 'Liabilities', INCOME: 'Income', EXPENSE: 'Expenses', CAPITAL: 'Capital' };

const postable = (a: Account) => !a.isGroup && a.isActive;
const isIncome = (a: Account) => a.type === 'INCOME';
/**
 * What a purchase can be booked to: an expense, or an asset bought for use
 * (Computers & IT Equipment). Not the books' own asset accounts (receivables,
 * input tax, stock in hand, advances) and not bank or cash.
 */
const isPurchaseAccount = (a: Account) => a.type === 'EXPENSE' || (a.type === 'ASSETS' && !a.systemKey && !MONEY_NAME.test(a.name));

/** Accounts as options, under their group's name, the groups in chart order. */
function accountOptions(all: Account[], keep: (a: Account) => boolean, current: string, typeOrder: string[]): SearchOption[] {
  const byId = new Map(all.map((a) => [a._id, a]));
  const rank = (a: Account) => {
    const r = typeOrder.indexOf(a.type);
    return r === -1 ? typeOrder.length : r;
  };
  const parentCode = (a: Account) => (a.parentId ? byId.get(a.parentId)?.code ?? '' : '');
  return all
    .filter((a) => !a.isGroup && keep(a) && (a.isActive || a._id === current))
    .sort((a, b) => rank(a) - rank(b) || parentCode(a).localeCompare(parentCode(b)) || a.code.localeCompare(b.code))
    .map((a) => ({
      value: a._id,
      label: a.isActive ? a.name : `${a.name} (inactive)`,
      detail: a.code,
      group: (a.parentId ? byId.get(a.parentId)?.name : undefined) ?? TYPE_LABEL[a.type] ?? a.type,
    }));
}

const UNIT_OPTIONS: SearchOption[] = UNITS.map((u) => ({ value: u.code, label: `${u.code} - ${u.name}` }));

/**
 * An item on one page, laid out as it is used: what it is, how it is sold,
 * how it is bought, and whether its stock is counted. The sales and purchase
 * accounts are chosen for the person (Sales Revenue, or Service Revenue for a
 * service; Purchases) and can be changed. New and edit share it; an edit
 * sends only what changed.
 */
export function ItemForm({ item, onDone }: { item?: ItemOption | null; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const editing = !!item;
  const [form, setForm] = useState<Form>(() => fromItem(item));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const [hsnSource, setHsnSource] = useState<HsnSource | null>(() =>
    item?.hsnSource && item.hsnSource.by !== 'person' ? { by: item.hsnSource.by, reason: item.hsnSource.reason, confidence: item.hsnSource.confidence } : null,
  );
  const [suggestion, setSuggestion] = useState<SuggestionView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const accounts = useAccounts();
  const vendors = useVendors();
  const all = useMemo(() => accounts.data ?? [], [accounts.data]);

  // The defaults, by what the chart calls them.
  const salesRevenue = all.find((a) => a.systemKey === 'SALES_REVENUE' && postable(a)) ?? null;
  const serviceRevenue = all.find((a) => postable(a) && isIncome(a) && SERVICE_INCOME.test(a.name.trim())) ?? null;
  const purchases = all.find((a) => a.systemKey === 'PURCHASE_EXPENSE' && postable(a)) ?? null;
  const defaultIncome = form.kind === 'service' ? serviceRevenue ?? salesRevenue : salesRevenue;
  const incomeId = form.incomeAccountId || defaultIncome?._id || '';
  const expenseId = form.expenseAccountId || purchases?._id || '';

  const incomeOptions = useMemo(() => accountOptions(all, isIncome, form.incomeAccountId, ['INCOME']), [all, form.incomeAccountId]);
  const expenseOptions = useMemo(() => accountOptions(all, isPurchaseAccount, form.expenseAccountId, ['EXPENSE', 'ASSETS']), [all, form.expenseAccountId]);
  const vendorOptions = useMemo<SearchOption[]>(
    () => (vendors.data ?? []).map((v) => ({ value: v._id, label: v.name, detail: v.gstin ?? undefined, keywords: [v.city, v.email].filter(Boolean).join(' ') })),
    [vendors.data],
  );
  const nameOf = (id: string) => all.find((a) => a._id === id)?.name ?? null;

  // ---- The HSN/SAC suggestion: history, a rule, or the model in a background job.
  const ask = useMutation({
    mutationFn: () => api.post<SuggestionView>('/items/suggest-hsn', { name: form.name.trim(), description: form.description.trim() || null, kind: form.kind }),
    onSuccess: setSuggestion,
  });
  const pending = suggestion?.status === 'queued' && suggestion.id ? suggestion.id : null;
  const poll = useQuery({
    queryKey: ['items', 'suggestion', pending],
    queryFn: () => api.get<SuggestionView>(`/items/suggestions/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') setSuggestion(poll.data);
  }, [poll.data]);

  const take = (s: Suggestion) => {
    setForm((f) => ({
      ...f,
      hsnSac: s.hsnSac,
      kind: s.kind,
      uqc: s.kind === 'goods' && s.uqc && s.uqc !== 'NA' ? s.uqc : f.uqc,
      gstRatePct: s.gstRatePct === null ? f.gstRatePct : String(s.gstRatePct),
    }));
    setHsnSource({ by: s.source, reason: s.reason, confidence: s.confidence });
    setSuggestion(null);
  };
  const shown = suggestion?.suggestion;

  // ---- What is sent: rupees become paise here, once.
  const build = (): Record<string, unknown> => {
    if (!form.name.trim()) throw new Error('Give the item a name.');
    const price = (text: string, label: string) => {
      if (!text.trim()) return null;
      const p = parseRupees(text);
      if (p === null || p < 0) throw new Error(`Enter the ${label} in rupees, like 1,250.50.`);
      return p;
    };
    const salePricePaise = price(form.sale, 'selling price');
    const purchasePricePaise = price(form.purchase, 'cost price');
    if (form.forSale && !incomeId) throw new Error('Pick the account its sales go to.');
    if (form.forPurchase && !expenseId) throw new Error('Pick the account its purchases go to.');
    const goods = form.kind === 'goods';
    const counted = goods && form.trackStock;
    const qty = (v: string) => (v.trim() === '' ? null : Number(v));
    const reorderLevel = counted ? qty(form.reorderLevel) : null;
    const reorderQty = counted ? qty(form.reorderQty) : null;
    if ((reorderLevel !== null && !(reorderLevel >= 0)) || (reorderQty !== null && !(reorderQty > 0))) {
      throw new Error('Reorder level and quantity are numbers, the quantity more than nothing.');
    }
    const hsnSac = form.hsnSac.trim() || null;
    return {
      name: form.name.trim(),
      code: form.code.trim() || null,
      kind: form.kind,
      uqc: goods ? form.uqc : 'NA',
      hsnSac,
      // Kept only while the code is the one suggested.
      hsnSource: hsnSac && hsnSource ? hsnSource : null,
      gstRatePct: form.gstRatePct === '' ? null : Number(form.gstRatePct),
      forSale: form.forSale,
      salePricePaise,
      incomeAccountId: incomeId || null,
      description: form.description.trim() || null,
      forPurchase: form.forPurchase,
      purchasePricePaise,
      expenseAccountId: expenseId || null,
      purchaseDescription: form.purchaseDescription.trim() || null,
      preferredVendorId: form.preferredVendorId || null,
      trackStock: counted,
      reorderLevel,
      reorderQty,
    };
  };

  /** On an edit, only the fields that differ from the saved item. */
  const changes = (body: Record<string, unknown>, saved: ItemOption): Record<string, unknown> => {
    const before: Record<string, unknown> = {
      name: saved.name,
      code: saved.code ?? null,
      kind: saved.kind,
      uqc: saved.uqc,
      gstRatePct: saved.gstRatePct ?? null,
      forSale: saved.forSale !== false,
      salePricePaise: saved.salePricePaise ?? null,
      incomeAccountId: saved.incomeAccountId ?? null,
      description: saved.description ?? null,
      forPurchase: saved.forPurchase !== false,
      purchasePricePaise: saved.purchasePricePaise ?? null,
      expenseAccountId: saved.expenseAccountId ?? null,
      purchaseDescription: saved.purchaseDescription ?? null,
      preferredVendorId: saved.preferredVendorId ?? null,
      trackStock: saved.kind === 'goods' && saved.trackStock !== false,
      reorderLevel: saved.reorderLevel ?? null,
      reorderQty: saved.reorderQty ?? null,
    };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'hsnSac' || k === 'hsnSource') continue;
      if (JSON.stringify(v) !== JSON.stringify(before[k])) out[k] = v;
    }
    // The code goes with where it came from; left alone, the item keeps both.
    const savedSource = saved.hsnSource && saved.hsnSource.by !== 'person' ? saved.hsnSource.by : null;
    const source = body.hsnSource as HsnSource | null;
    if (body.hsnSac !== (saved.hsnSac ?? null) || (source?.by ?? null) !== savedSource) {
      out.hsnSac = body.hsnSac;
      out.hsnSource = body.hsnSource;
    }
    return out;
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = build();
      if (!item) return (await api.post<{ _id: string }>('/items', body))._id;
      const patch = changes(body, item);
      if (Object.keys(patch).length) await api.patch(`/items/${item._id}`, patch);
      return item._id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      notify('Item saved');
      onDone(id);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the item. Try again.")),
  });

  const switchKind = (kind: Kind) => setForm((f) => ({ ...f, kind }));
  const service = form.kind === 'service';

  // What an item without an account of its own posted to until now.
  const incomeMoved = editing && !item?.incomeAccountId && salesRevenue && incomeId && incomeId !== salesRevenue._id;

  const checkbox = 'h-4 w-4 cursor-pointer rounded-sm border-line-200 accent-brand-600 disabled:cursor-not-allowed';
  const textarea = `${inputClass} min-h-[76px] resize-y`;

  return (
    <FormPage
      onSubmit={() => {
        setProblem(null);
        setTried(true);
        save.mutate();
      }}
      error={problem}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save item'}</Button>
          <Button type="button" variant="secondary" asChild>
            <Link href="/items">Cancel</Link>
          </Button>
        </>
      }
    >
      <Section title="Item" description="What it is, and the GST details every line that uses it takes.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required>
            <input
              className={cn(inputClass, tried && !form.name.trim() && 'border-error-fg')}
              value={form.name}
              maxLength={200}
              autoFocus={!editing}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Dell Latitude 5440 laptop"
            />
          </Field>
          <Field label="Code / SKU" hint="Your own code for it, if you use one.">
            <input className={`${inputClass} font-mono`} value={form.code} maxLength={50} onChange={(e) => set('code', e.target.value)} placeholder="LAP-5440" />
          </Field>

          <Field label="Type">
            <div className="flex h-[42px] items-center gap-6" role="radiogroup" aria-label="Type">
              {(['goods', 'service'] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-body text-ink-900">
                  <input type="radio" name="item-kind" className="h-4 w-4 cursor-pointer accent-brand-600" checked={form.kind === k} onChange={() => switchKind(k)} />
                  {k === 'goods' ? 'Goods' : 'Service'}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Unit" hint={service ? 'Services carry no unit on the GST return.' : 'The GST unit (UQC) the GSTR-1 HSN summary counts it in.'}>
            {service ? (
              <input className={inputClass} value="No unit (a service)" disabled aria-label="Unit" />
            ) : (
              <SearchSelect value={form.uqc} onChange={(v) => set('uqc', v)} options={UNIT_OPTIONS} placeholder="Select a unit" searchPlaceholder="Type a code or name, like kg" aria-label="Unit" />
            )}
          </Field>

          <Field label={service ? 'SAC code' : 'HSN code'} hint={hsnSource ? `Suggested ${SOURCE_LABEL[hsnSource.by]}${hsnSource.reason ? `: ${hsnSource.reason}` : ''}.` : undefined}>
            <div className="flex gap-2">
              <input
                className={`${inputClass} font-mono`}
                inputMode="numeric"
                value={form.hsnSac}
                onChange={(e) => {
                  set('hsnSac', e.target.value.replace(/\D/g, '').slice(0, 8));
                  // A code typed over a suggestion is the person's own.
                  setHsnSource(null);
                }}
                placeholder={service ? '998314' : '8471'}
              />
              <Button type="button" variant="secondary" className="shrink-0" disabled={!form.name.trim() || ask.isPending || !!pending} onClick={() => ask.mutate()}>
                {ask.isPending || pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-marigold-400" />} Suggest code
              </Button>
            </div>
          </Field>
          <Field label="GST rate">
            <select className={inputClass} value={form.gstRatePct} onChange={(e) => set('gstRatePct', e.target.value)}>
              <option value="">Not set</option>
              {RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          </Field>

          {(ask.isError || pending || (suggestion && suggestion.status !== 'queued')) && (
            <div className="md:col-span-2">
              {ask.isError && <p className="text-caption text-error-fg">{errorText(ask.error)}</p>}
              {pending && <p className="flex items-center gap-2 text-caption text-ink-500"><Loader2 size={13} className="animate-spin" /> Asking AI…</p>}
              {suggestion && suggestion.status !== 'queued' && !shown && suggestion.message && <p className="text-caption text-ink-500">{suggestion.message}</p>}
              {shown && (
                <div className="rounded-md border border-pending-fg/20 bg-pending-bg p-3 text-caption text-pending-fg">
                  <p>
                    <span className="font-mono font-semibold">{shown.hsnSac}</span>
                    {shown.gstRatePct !== null ? ` · ${shown.gstRatePct}% GST` : ' · rate depends on details: set it yourself'}
                    {shown.kind === 'goods' ? ` · ${shown.uqc}` : ' · a service'}
                  </p>
                  <p className="mt-0.5">
                    {shown.reason}, {SOURCE_LABEL[shown.source]} ({Math.round(shown.confidence * 100)}% sure). Check it before you use it.
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <Button type="button" size="sm" variant="secondary" onClick={() => take(shown)}>Use this code</Button>
                    <button type="button" className="text-ink-500 hover:underline" onClick={() => setSuggestion(null)}>Dismiss</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title={
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className={checkbox}
                checked={form.forSale}
                disabled={form.forSale && !form.forPurchase}
                title={form.forSale && !form.forPurchase ? 'An item is sold, bought, or both.' : undefined}
                onChange={(e) => set('forSale', e.target.checked)}
              />
              Sales information
            </label>
          }
          description={form.forSale ? 'Offered on invoices, quotes, sales orders and challans.' : 'Not sold: it is left off invoices, quotes, orders and challans.'}
        >
          <fieldset disabled={!form.forSale} className={cn('space-y-4', !form.forSale && 'opacity-60')}>
            <Field label="Selling price" hint="Fills the rate on a sales line. Blank to type it each time.">
              <RupeeInput value={form.sale} onChange={(v) => set('sale', v)} label="Selling price" />
            </Field>
            <Field
              label="Account"
              required
              hint={
                incomeMoved
                  ? `It had no account of its own, so its sales went to ${salesRevenue?.name}. Saving sets ${nameOf(incomeId)}.`
                  : !form.incomeAccountId && incomeId
                    ? `Chosen for ${service ? 'a service' : 'goods'}. Change it if its sales belong elsewhere.`
                    : undefined
              }
            >
              <SearchSelect
                value={incomeId}
                onChange={(v) => set('incomeAccountId', v)}
                options={incomeOptions}
                placeholder={accounts.isLoading ? 'Loading accounts…' : 'Select an account'}
                searchPlaceholder="Search income accounts"
                invalid={tried && form.forSale && !incomeId}
                aria-label="Sales account"
              />
            </Field>
            <Field label="Description" hint="Also helps the code suggestion pick the right HSN/SAC.">
              <textarea className={textarea} rows={3} maxLength={1000} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="14-inch business laptop, i5, 16 GB" />
            </Field>
          </fieldset>
        </Section>

        <Section
          title={
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className={checkbox}
                checked={form.forPurchase}
                disabled={form.forPurchase && !form.forSale}
                title={form.forPurchase && !form.forSale ? 'An item is sold, bought, or both.' : undefined}
                onChange={(e) => set('forPurchase', e.target.checked)}
              />
              Purchase information
            </label>
          }
          description={form.forPurchase ? 'Offered on bills and purchase orders.' : 'Not bought: it is left off bills and purchase orders.'}
        >
          <fieldset disabled={!form.forPurchase} className={cn('space-y-4', !form.forPurchase && 'opacity-60')}>
            <Field label="Cost price" hint="Fills the rate on a purchase line. Blank to type it each time.">
              <RupeeInput value={form.purchase} onChange={(v) => set('purchase', v)} label="Cost price" />
            </Field>
            <Field
              label="Account"
              required
              hint={!form.expenseAccountId && expenseId ? 'Chosen for you. For things kept for use, pick an asset account like Computers & IT Equipment.' : undefined}
            >
              <SearchSelect
                value={expenseId}
                onChange={(v) => set('expenseAccountId', v)}
                options={expenseOptions}
                placeholder={accounts.isLoading ? 'Loading accounts…' : 'Select an account'}
                searchPlaceholder="Search expense and asset accounts"
                invalid={tried && form.forPurchase && !expenseId}
                aria-label="Purchase account"
              />
            </Field>
            <Field label="Description" hint="What a bill line says. Blank to use the item's name.">
              <textarea className={textarea} rows={3} maxLength={1000} value={form.purchaseDescription} onChange={(e) => set('purchaseDescription', e.target.value)} placeholder="As the vendor's bill describes it" />
            </Field>
            <Field label="Preferred vendor">
              <SearchSelect
                value={form.preferredVendorId}
                onChange={(v) => set('preferredVendorId', v)}
                options={vendorOptions}
                noneLabel="No preferred vendor"
                placeholder={vendors.isLoading ? 'Loading vendors…' : 'No preferred vendor'}
                searchPlaceholder="Search vendors"
                aria-label="Preferred vendor"
              />
            </Field>
          </fieldset>
        </Section>
      </div>

      {!service && (
        <Section title="Inventory" description="Bills bring it in, invoices take it out, valued at weighted-average cost.">
          <label className="flex cursor-pointer items-center gap-2 text-body text-ink-900">
            <input type="checkbox" className={checkbox} checked={form.trackStock} onChange={(e) => set('trackStock', e.target.checked)} />
            Track stock for this item
          </label>
          {form.trackStock ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Reorder level" hint="Flag it to buy more at or under this many. Blank: worked out from its sales.">
                <input className={`${inputClass} font-mono`} inputMode="decimal" value={form.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} placeholder="From sales" />
              </Field>
              <Field label="Reorder quantity" hint="How many to order then. Blank: about six weeks' sales.">
                <input className={`${inputClass} font-mono`} inputMode="decimal" value={form.reorderQty} onChange={(e) => set('reorderQty', e.target.value)} placeholder="Six weeks' sales" />
              </Field>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-info-fg/20 bg-info-bg px-4 py-3 text-info-fg">
              <Info size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">Do you want to keep track of this item?</p>
                <p className="mt-0.5 text-caption">
                  Track its stock to see how many you hold on any date and what they are worth, get told when to reorder, and have the month-end closing-stock entry count it. Leave it off for consumables nobody counts.
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => set('trackStock', true)}>Track stock</Button>
            </div>
          )}
        </Section>
      )}
    </FormPage>
  );
}

/** Money typed in rupees, behind a ₹ sign. */
function RupeeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-l-md border border-r-0 border-line-200 bg-surface-sink px-3 text-body font-medium text-ink-500">₹</span>
      <input className={`${inputClass} rounded-l-none font-mono`} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </div>
  );
}
