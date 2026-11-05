'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Paperclip, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { errorText, formatMinor, shortDate, todayIst, type CustomerRow, type InvoiceRow } from '@/components/sales/sales-data';
import { parseMinor, usePaidThroughAccounts, type BillRow, type VendorRecord } from '@/components/purchases/purchase-data';
import { PAYMENT_MODES } from './payment-details';

export type PaymentKind = 'receipt' | 'payment';

interface Suggestion {
  allocations: Array<{ documentId: string; amountPaise: number }>;
  advancePaise: number;
  method: string;
  reason: string;
}

/** GET /currency/documents — foreign invoices and bills with what is still open in their currency. */
interface ForeignDoc {
  kind: 'invoice' | 'bill';
  id: string;
  number: string | null;
  date: string;
  status: string;
  currency: string;
  rate: number;
  openMinor: number;
  digits: number;
}

/** An open invoice or bill, as the table shows it. */
interface OpenDoc {
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  totalPaise: number;
  owedPaise: number;
  href: string;
  note: string | null;
}

/** What differs between money in from a customer and money out to a vendor. */
const COPY = {
  receipt: {
    party: 'Customer',
    choose: 'Choose a customer…',
    amount: 'Amount received',
    date: 'Payment date',
    account: 'Deposit to',
    doc: 'invoice',
    docs: 'Unpaid invoices',
    docNo: 'Invoice #',
    docAmount: 'Invoice amount',
    prefix: 'RCT',
    action: 'Record receipt',
    pending: 'Recording…',
    done: 'Receipt recorded',
    noun: 'receipt',
    list: '/sales/payments-received',
    summaryAmount: 'Amount received',
    chargesHint: 'What the bank kept. The customer is still credited with the whole amount.',
    excess: 'Held as an advance on Advances from Customers until you apply it to an invoice or refund it. GST is due on advances for services when received; check with your CA.',
  },
  payment: {
    party: 'Vendor',
    choose: 'Choose a vendor…',
    amount: 'Amount paid',
    date: 'Payment date',
    account: 'Paid through',
    doc: 'bill',
    docs: 'Unpaid bills',
    docNo: 'Bill #',
    docAmount: 'Bill amount',
    prefix: 'PMT',
    action: 'Record payment',
    pending: 'Recording…',
    done: 'Payment recorded',
    noun: 'payment',
    list: '/purchases/payments-made',
    summaryAmount: 'Amount paid',
    chargesHint: 'What the bank charged on top. It is paid out with the amount and booked to Bank Charges.',
    excess: 'Held as an advance on Advances to Vendors until you apply it to a bill or the vendor refunds it.',
  },
} as const;

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN = /^\d{2}([A-Z]{5}\d{4}[A-Z])[1-9A-Z]Z[0-9A-Z]$/;

/** The party's PAN: their own, or the one inside their GSTIN. */
function panOf(pan: string | null | undefined, gstin: string | null | undefined): { pan: string; fromGstin: boolean } | null {
  const own = pan?.trim().toUpperCase();
  if (own && PAN.test(own)) return { pan: own, fromGstin: false };
  const m = gstin?.trim().toUpperCase().match(GSTIN);
  return m ? { pan: m[1], fromGstin: true } : null;
}

/** Indian financial year of a YYYY-MM-DD date, e.g. "2026-27". */
function fyOf(date: string): string | null {
  const [y, m] = date.split('-').map(Number);
  if (!y || !m) return null;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const rupeesText = (paise: number) => (paise ? (paise / 100).toFixed(2) : '');
const cell = 'w-28 rounded-md border border-line-200 bg-white px-2 py-1 text-right font-mono text-caption tabular-nums focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/** A rupee amount: right-aligned, tabular, with the ₹ in front. */
function MoneyInput({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body text-ink-500">₹</span>
      <input
        aria-label={label}
        className={cn(inputClass, 'pl-7 text-right font-mono tabular-nums', invalid && 'border-error-fg')}
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Row({ label, value, tone, strong, muted }: { label: React.ReactNode; value: string; tone?: 'error' | 'pending'; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={cn('text-body', muted ? 'text-ink-500' : 'text-ink-700', strong && 'font-medium text-ink-900')}>{label}</dt>
      <dd
        className={cn(
          'font-mono tabular-nums text-body',
          tone === 'error' ? 'text-error-fg' : tone === 'pending' ? 'text-pending-fg' : muted ? 'text-ink-500' : 'text-ink-900',
          strong && 'font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** A foreign bill is paid in its currency, at the day's rate; the difference is exchange gain or loss. */
function ForeignBillPayment({ doc, onDone }: { doc: ForeignDoc; onDone: () => void }) {
  const [amount, setAmount] = useState((doc.openMinor / 10 ** doc.digits).toFixed(doc.digits));
  const [rate, setRate] = useState(String(doc.rate));
  const [paidOn, setPaidOn] = useState(todayIst());
  const minor = parseMinor(amount, doc.digits);
  const pay = useMutation({
    mutationFn: () => api.post(`/currency/bills/${doc.id}/pay`, { paidOn, amountMinor: minor, rate: Number(rate) }),
    onSuccess: () => {
      notify('Payment recorded');
      onDone();
    },
    onError: (e) => notify(errorText(e, "Couldn't record that payment."), 'error'),
  });
  const small = `${inputClass} py-1.5`;
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line-100 py-3 last:border-0">
      <div className="min-w-[180px] flex-1">
        <Link href={`/purchases/bills/${doc.id}`} className="font-mono text-body hover:underline">{doc.number ?? 'No number'}</Link>
        <p className="text-caption text-ink-500">{shortDate(doc.date)} · {formatMinor(doc.openMinor, doc.currency, doc.digits)} owed · booked at ₹{doc.rate}</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Amount ({doc.currency})</span>
        <input className={`${small} w-32 text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Rate (₹)</span>
        <input className={`${small} w-28 text-right font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Paid on</span>
        <input type="date" className={`${small} w-40`} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <Button type="button" size="sm" disabled={pay.isPending || minor === null || minor <= 0 || minor > doc.openMinor || !(Number(rate) > 0)} onClick={() => pay.mutate()}>
        {pay.isPending ? 'Recording…' : 'Record payment'}
      </Button>
    </div>
  );
}

/**
 * One receipt from a customer, or one payment to a vendor, across as many of
 * their open invoices or bills as it settles: the amount, any bank charges,
 * the date, how it moved and which bank or cash account, with notes and files.
 * Whatever is not applied is held as an advance. "Suggest allocation" fills the
 * amounts from the reference, an exact combination, or oldest first; the
 * person checks and changes them before recording. The number is taken when
 * it is recorded, so the series has no gaps. A payment policy may hold money
 * out for approval.
 */
export function RecordPaymentForm({ kind, initialPartyId }: { kind: PaymentKind; initialPartyId: string }) {
  const c = COPY[kind];
  const isReceipt = kind === 'receipt';
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () => {
    for (const key of ['sales', 'purchase', 'payments', 'journals', 'reports', 'approvals', 'currency', 'gst', 'attachments']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const [partyId, setPartyId] = useState(initialPartyId);
  const [amount, setAmount] = useState('');
  const [charges, setCharges] = useState('');
  const [date, setDate] = useState(todayIst());
  const [mode, setMode] = useState('bank_transfer');
  const [accountId, setAccountId] = useState('');
  const [via, setVia] = useState<'bank' | 'cash'>('bank');
  const [reference, setReference] = useState('');
  const [tdsOn, setTdsOn] = useState(false);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [tds, setTds] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Parties, and their open documents in rupees. Foreign ones are paid from the document, in its currency.
  const customers = useQuery({ queryKey: ['sales', 'customers'], queryFn: () => api.get<CustomerRow[]>('/sales/customers'), enabled: isReceipt });
  const vendors = useQuery({ queryKey: ['purchase', 'vendors'], queryFn: () => api.get<VendorRecord[]>('/purchase/vendors'), enabled: !isReceipt });
  const invoices = useQuery({
    queryKey: ['sales', 'invoices', { customerId: partyId, status: 'posted' }],
    queryFn: () => api.get<InvoiceRow[]>(`/sales/invoices?status=posted&customerId=${encodeURIComponent(partyId)}`),
    enabled: isReceipt && !!partyId,
  });
  const bills = useQuery({ queryKey: ['purchase', 'bills', { status: 'posted' }], queryFn: () => api.get<BillRow[]>('/purchase/bills?status=posted'), enabled: !isReceipt });
  const foreignDocs = useQuery({ queryKey: ['currency', 'documents'], queryFn: () => api.get<ForeignDoc[]>('/currency/documents'), retry: false });
  const accounts = usePaidThroughAccounts();

  const docKind = isReceipt ? 'invoice' : 'bill';
  const foreignIds = new Set((foreignDocs.data ?? []).filter((d) => d.kind === docKind).map((d) => d.id));
  const open: OpenDoc[] = isReceipt
    ? (invoices.data ?? [])
        .filter((d) => d.customerId === partyId && d.status === 'posted' && d.outstandingPaise > 0)
        .map((d) => ({ id: d._id, number: d.invoiceNumber, date: d.invoiceDate, dueDate: d.dueDate, totalPaise: d.amountsPaise.total, owedPaise: d.outstandingPaise, href: `/sales/invoices/${d._id}`, note: null }))
    : (bills.data ?? [])
        .filter((b) => b.vendorId === partyId && b.status === 'posted' && b.outstandingPaise > 0)
        .map((b) => ({ id: b._id, number: b.billNumber, date: b.billDate, dueDate: b.dueDate, totalPaise: b.totalPaise, owedPaise: b.outstandingPaise, href: `/purchases/bills/${b._id}`, note: b.msmePayBy ? `MSME, pay by ${shortDate(b.msmePayBy)}` : null }));
  const rows = open.filter((d) => !foreignIds.has(d.id)).sort((a, b) => a.date.localeCompare(b.date));
  const foreignOpen = (foreignDocs.data ?? []).filter((d) => d.kind === docKind && d.status === 'posted' && d.openMinor > 0 && open.some((o) => o.id === d.id));
  const shown = range ? rows.filter((r) => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to)) : rows;
  const docsLoading = isReceipt ? invoices.isLoading && !!partyId : bills.isLoading;

  // The party, and their PAN.
  const party = isReceipt
    ? (() => {
        const p = (customers.data ?? []).find((x) => x._id === partyId);
        return p ? { name: p.name, pan: panOf((p as CustomerRow & { pan?: string | null }).pan, p.gstin), owes: p.receivablePaise, edit: `/sales/customers/${p._id}/edit` } : null;
      })()
    : (() => {
        const p = (vendors.data ?? []).find((x) => x._id === partyId);
        return p ? { name: p.name, pan: panOf(p.pan, p.gstin), owes: p.outstandingPaise ?? 0, edit: `/purchases/vendors/${p._id}/edit` } : null;
      })();
  const partyOptions = isReceipt
    ? (customers.data ?? []).map((p) => ({ id: p._id, label: `${p.name}${p.receivablePaise > 0 ? ` · owes ${formatPaise(p.receivablePaise)}` : ''}` }))
    : (vendors.data ?? []).map((p) => ({ id: p._id, label: `${p.name}${(p.outstandingPaise ?? 0) > 0 ? ` · ${formatPaise(p.outstandingPaise ?? 0)} owed` : ''}` }));
  const partiesLoading = isReceipt ? customers.isLoading : vendors.isLoading;

  // The money account: chosen from the org's bank and cash ledgers; Bank or Cash if they cannot be listed.
  const moneyAccounts = accounts.data ?? [];
  const account = moneyAccounts.find((a) => a._id === accountId) ?? moneyAccounts.find((a) => a.kind === 'bank') ?? moneyAccounts[0] ?? null;
  const chooseAccount = (id: string) => {
    setAccountId(id);
    const next = moneyAccounts.find((a) => a._id === id);
    if (next?.kind === 'cash') setMode('cash');
    else if (mode === 'cash') setMode('bank_transfer');
  };
  const chooseMode = (m: string) => {
    setMode(m);
    const cash = moneyAccounts.find((a) => a.kind === 'cash');
    const bank = moneyAccounts.find((a) => a.kind === 'bank');
    if (m === 'cash' && cash && account?.kind !== 'cash') setAccountId(cash._id);
    if (m !== 'cash' && account?.kind === 'cash' && bank) setAccountId(bank._id);
    if (!moneyAccounts.length) setVia(m === 'cash' ? 'cash' : 'bank');
  };

  // The figures.
  const amountPaise = parseRupees(amount);
  const chargesPaise = parseRupees(charges);
  const paise = (t: string | undefined) => parseRupees(t ?? '') ?? 0;
  const appliedPaise = rows.reduce((s, r) => s + paise(applied[r.id]), 0);
  const tdsPaise = tdsOn ? rows.reduce((s, r) => s + paise(tds[r.id]), 0) : 0;
  const hiddenApplied = rows.filter((r) => !shown.includes(r) && (paise(applied[r.id]) > 0 || (tdsOn && paise(tds[r.id]) > 0)));
  const excess = (amountPaise ?? 0) - appliedPaise;
  const overOwed = rows.find((r) => paise(applied[r.id]) + (tdsOn ? paise(tds[r.id]) : 0) > r.owedPaise);
  const unreadable = [...Object.values(applied), ...(tdsOn ? Object.values(tds) : [])].some((t) => (parseRupees(t) ?? -1) < 0);
  const bankPaise = (amountPaise ?? 0) + (isReceipt ? -(chargesPaise ?? 0) : chargesPaise ?? 0);

  const problem =
    !partyId ? `Choose the ${c.party.toLowerCase()}.`
      : amountPaise === null || amountPaise < 0 ? `Enter the ${c.amount.toLowerCase()} in rupees, like 1,250.50.`
      : chargesPaise === null || chargesPaise < 0 ? 'Enter the bank charges in rupees, like 15.00, or leave them blank.'
      : isReceipt && (chargesPaise ?? 0) > (amountPaise ?? 0) ? `The bank charges are more than the ${formatPaise(amountPaise ?? 0)} received.`
      : unreadable ? `Enter each amount${tdsOn ? ' and TDS' : ''} in rupees, like 1,250.50.`
      : overOwed ? `${overOwed.number ?? `One ${c.doc}`} has only ${formatPaise(overOwed.owedPaise)} owed.`
      : excess < 0 ? `${formatPaise(-excess)} more is applied than was ${isReceipt ? 'received' : 'paid'}.`
      : (amountPaise ?? 0) === 0 && tdsPaise === 0 ? `Enter the ${c.amount.toLowerCase()}.`
      : null;

  const pick = (id: string) => {
    setPartyId(id);
    setApplied({});
    setTds({});
    setSuggested(new Set());
    setHint(null);
    setHeld(null);
  };
  const setOne = (id: string, value: string) => {
    setApplied({ ...applied, [id]: value });
    if (suggested.has(id)) setSuggested(new Set([...suggested].filter((x) => x !== id)));
  };
  const clearApplied = () => {
    setApplied({});
    setTds({});
    setSuggested(new Set());
    setHint(null);
  };

  const suggest = useMutation({
    mutationFn: () => api.post<Suggestion>('/payments/suggest', { kind, partyId, amountPaise: amountPaise ?? 0, text: reference.trim() || undefined }),
    onSuccess: (s) => {
      setApplied(Object.fromEntries(s.allocations.map((a) => [a.documentId, rupeesText(a.amountPaise)])));
      setTds({});
      setSuggested(new Set(s.allocations.map((a) => a.documentId)));
      setHint(s.reason);
    },
    onError: (e) => notify(errorText(e, "Couldn't suggest an allocation."), 'error'),
  });

  /** Files go up once the payment exists to hold them; a file that fails is said, and the payment stands. */
  const attach = async (id: string) => {
    const failed: string[] = [];
    for (const file of files) {
      const body = new FormData();
      body.append('entityType', 'PartyPayment');
      body.append('entityId', id);
      body.append('file', file);
      try {
        await api.post('/attachments', body);
      } catch {
        failed.push(file.name);
      }
    }
    return failed;
  };

  const save = useMutation({
    mutationFn: async () => {
      const saved = await api.post<{ _id: string; number: string | null }>('/payments', {
        kind,
        partyId,
        date,
        amountPaise: amountPaise ?? 0,
        via: account ? (account.kind === 'cash' ? 'cash' : 'bank') : via,
        ...(account ? { depositAccountId: account._id } : {}),
        mode,
        bankChargesPaise: chargesPaise ?? 0,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        // TDS is the customer's to deduct; on a bill it was withheld when the bill was posted.
        allocations: rows
          .map((r): { documentId: string; amountPaise: number; tdsPaise?: number } =>
            isReceipt ? { documentId: r.id, amountPaise: paise(applied[r.id]), tdsPaise: tdsOn ? paise(tds[r.id]) : 0 } : { documentId: r.id, amountPaise: paise(applied[r.id]) },
          )
          .filter((a) => a.amountPaise > 0 || (a.tdsPaise ?? 0) > 0),
      });
      return { saved, failed: await attach(saved._id) };
    },
    onSuccess: ({ failed }) => {
      refresh();
      notify(c.done);
      if (failed.length) notify(`Couldn't attach ${failed.join(', ')}. Attach ${failed.length === 1 ? 'it' : 'them'} from the list.`, 'error');
      router.push(c.list);
    },
    onError: (e) => {
      // A policy holds money out for approval: nothing is posted yet.
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
        refresh();
      }
    },
  });

  const fy = fyOf(date);
  const error = held ? null : save.isError ? errorText(save.error, `Couldn't record the ${c.noun}.`) : (tried || amount !== '') && problem ? problem : null;

  return (
    <FormPage
      onSubmit={() => {
        setTried(true);
        if (!problem) save.mutate();
      }}
      error={error}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? c.pending : c.action}</Button>
          <Button asChild variant="secondary"><Link href={c.list}>Cancel</Link></Button>
        </>
      }
    >
      {held && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          {held} It posts when approved, on the <Link href="/approvals" className="underline">Approvals</Link> page. Attach files to it from {isReceipt ? 'Payments received' : 'Payments made'} once it is posted.
        </p>
      )}

      <Section>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`${c.party} name`} required className="md:col-span-2">
            <select className={inputClass} value={partyId} onChange={(e) => pick(e.target.value)}>
              <option value="">{partiesLoading ? 'Loading…' : c.choose}</option>
              {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          {party && (
            <div className="self-end pb-2 text-caption">
              {party.pan ? (
                <p className="text-ink-700">
                  PAN <span className="font-mono text-ink-900">{party.pan.pan}</span>
                  {party.pan.fromGstin && <span className="text-ink-500"> · from their GSTIN</span>}
                </p>
              ) : (
                <p className="text-ink-500">
                  No PAN on record · <Link href={party.edit} className="font-medium text-ink-700 hover:underline">{isReceipt ? 'Add their GSTIN' : 'Add PAN'}</Link>
                </p>
              )}
              {party.owes > 0 && <p className="text-ink-500">{isReceipt ? 'Owes' : 'You owe'} <span className="font-mono">{formatPaise(party.owes)}</span></p>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Payment details">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={c.amount} required>
            <MoneyInput label={c.amount} value={amount} onChange={setAmount} invalid={amount !== '' && (amountPaise === null || amountPaise < 0)} />
          </Field>
          <Field label="Bank charges (if any)" hint={c.chargesHint}>
            <MoneyInput label="Bank charges" value={charges} onChange={setCharges} invalid={chargesPaise === null || (chargesPaise ?? 0) < 0} />
          </Field>
          <Field label={c.date} required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Payment #" required hint="Numbered in order when it is recorded, with no gaps.">
            <div className={cn(inputClass, 'flex items-center justify-between gap-2 bg-surface-sink')} aria-readonly="true">
              <span className="font-mono text-ink-700">{c.prefix}/{fy ?? '…'}/····</span>
              <span className="text-caption text-ink-500">assigned when saved</span>
            </div>
          </Field>
          <Field label="Payment mode">
            <select className={inputClass} value={mode} onChange={(e) => chooseMode(e.target.value)}>
              {PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={c.account} required hint={accounts.isError ? "Your bank and cash accounts couldn't be listed: choose Bank or Cash." : undefined}>
            {moneyAccounts.length > 0 ? (
              <select className={inputClass} value={account?._id ?? ''} onChange={(e) => chooseAccount(e.target.value)}>
                {moneyAccounts.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}{a.kind === 'cash' ? ' · cash' : a.kind === 'bank' ? ' · bank' : ''}</option>
                ))}
              </select>
            ) : (
              <select className={inputClass} value={via} onChange={(e) => setVia(e.target.value as 'bank' | 'cash')} disabled={accounts.isLoading}>
                <option value="bank">{accounts.isLoading ? 'Loading…' : 'Bank'}</option>
                <option value="cash">Cash</option>
              </select>
            )}
          </Field>
          <Field label="Reference #" hint={`UTR, cheque number, or the ${c.doc} numbers it pays. Suggest allocation reads ${c.doc} numbers from it.`}>
            <input className={inputClass} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          {isReceipt && (
            <Field label="TDS deducted?" hint={tdsOn ? 'Enter the TDS on each invoice below. It is claimed against your own income tax.' : undefined}>
              <div className="flex h-10 items-center gap-5" role="radiogroup" aria-label="TDS deducted?">
                <label className="inline-flex items-center gap-2 text-body text-ink-700">
                  <input type="radio" name="tds" className="accent-saffron-600" checked={!tdsOn} onChange={() => { setTdsOn(false); setTds({}); }} /> No
                </label>
                <label className="inline-flex items-center gap-2 text-body text-ink-700">
                  <input type="radio" name="tds" className="accent-saffron-600" checked={tdsOn} onChange={() => setTdsOn(true)} /> Yes, TDS (income tax)
                </label>
              </div>
            </Field>
          )}
        </div>
      </Section>

      {partyId && (
        <Section
          title={c.docs}
          description={`How much of the ${c.noun} goes to each${tdsOn ? ', and the TDS deducted on it' : ''}. The rest is held as an advance.`}
          actions={
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRange(range ? null : { from: '', to: '' })}>
                <CalendarRange size={13} /> {range ? 'Show all dates' : 'Filter by date range'}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={appliedPaise === 0 && tdsPaise === 0} onClick={clearApplied}>Clear applied amount</Button>
              <Button type="button" size="sm" variant="secondary" disabled={!amountPaise || suggest.isPending || rows.length === 0} onClick={() => suggest.mutate()}>
                <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest allocation'}
              </Button>
            </>
          }
        >
          {range && (
            <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-surface-sink px-3 py-2">
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-ink-700">From</span>
                <input type="date" className={`${inputClass} w-40 py-1.5`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-ink-700">To</span>
                <input type="date" className={`${inputClass} w-40 py-1.5`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </label>
              <p className="pb-2 text-caption text-ink-500">{shown.length} of {rows.length} {c.doc}s</p>
            </div>
          )}
          {hint && <p className="mb-3 rounded-md bg-honey-100 px-3 py-2 text-caption text-pending-fg">Suggested: {hint} Check before recording.</p>}
          {docsLoading ? (
            <p className="text-caption text-ink-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-caption text-ink-500">{party?.name ?? `This ${c.party.toLowerCase()}`} has no unpaid {c.doc}s in rupees. All of this will be held as an advance.</p>
          ) : (
            <TableCard className="border-line-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className={th}>Date</th>
                    <th className={th}>{c.docNo}</th>
                    <th className={th}>Due</th>
                    <th className={`${th} text-right`}>{c.docAmount}</th>
                    <th className={`${th} text-right`}>Amount due</th>
                    {tdsOn && <th className={`${th} text-right`}>TDS (₹)</th>}
                    <th className={`${th} text-right`}>Payment (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr><td colSpan={tdsOn ? 7 : 6} className="px-3 py-6 text-center text-caption text-ink-400">No {c.doc}s in these dates.</td></tr>
                  ) : (
                    shown.map((r) => (
                      // An amount the AI suggested stays marked, amber, until the person changes it.
                      <tr key={r.id} className={cn('border-b border-line-100 last:border-0', suggested.has(r.id) && 'bg-honey-50')} title={suggested.has(r.id) ? 'Suggested: check it' : undefined}>
                        <td className={cn(td, 'whitespace-nowrap text-caption', suggested.has(r.id) && 'shadow-[inset_3px_0_0_0_#FAB005]')}>{shortDate(r.date)}</td>
                        <td className={`${td} font-mono text-caption`}>
                          <Link href={r.href} className="hover:underline">{r.number ?? 'Not numbered'}</Link>
                          {r.note && <p className="font-sans text-[0.7rem] text-ink-500">{r.note}</p>}
                        </td>
                        <td className={`${td} whitespace-nowrap text-caption`}>{shortDate(r.dueDate)}</td>
                        <td className={tdMoney}>{formatPaise(r.totalPaise)}</td>
                        <td className={tdMoney}>{formatPaise(r.owedPaise)}</td>
                        {tdsOn && (
                          <td className="px-3 py-1.5 text-right">
                            <input aria-label={`TDS on ${r.number ?? r.id}`} className={cell} inputMode="decimal" placeholder="0" value={tds[r.id] ?? ''} onChange={(e) => setTds({ ...tds, [r.id]: e.target.value })} />
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              className="text-caption text-ink-500 hover:text-ink-900 hover:underline"
                              onClick={() => setOne(r.id, rupeesText(r.owedPaise - (tdsOn ? paise(tds[r.id]) : 0)))}
                            >
                              In full
                            </button>
                            <input
                              aria-label={`Payment for ${r.number ?? r.id}`}
                              className={cn(cell, overOwed?.id === r.id && 'border-error-fg')}
                              inputMode="decimal"
                              placeholder="0"
                              value={applied[r.id] ?? ''}
                              onChange={(e) => setOne(r.id, e.target.value)}
                            />
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-200 bg-surface-sink">
                    <td className={`${td} font-medium`} colSpan={4}>Total</td>
                    <td className={tdMoney}>{formatPaise(rows.reduce((s, r) => s + r.owedPaise, 0))}</td>
                    {tdsOn && <td className={`${tdMoney} font-semibold`}>{formatPaise(tdsPaise)}</td>}
                    <td className={`${tdMoney} font-semibold`}>{formatPaise(appliedPaise)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableCard>
          )}
          {hiddenApplied.length > 0 && (
            <p className="mt-2 text-caption text-ink-500">
              The total includes {hiddenApplied.length} {c.doc}{hiddenApplied.length === 1 ? '' : 's'} outside these dates with amounts applied.
            </p>
          )}

          {foreignOpen.length > 0 &&
            (isReceipt ? (
              <div className="mt-4 rounded-md border border-line-200 bg-surface-sink p-3">
                <p className="text-caption font-medium text-ink-700">In a foreign currency, received from the invoice at the day&apos;s rate:</p>
                <ul className="mt-1 space-y-1">
                  {foreignOpen.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-caption">
                      <span className="font-mono">{d.number ?? 'Not numbered'} · {formatMinor(d.openMinor, d.currency, d.digits)} owed</span>
                      <Link href={`/sales/invoices/${d.id}/receive`} className="font-medium text-ink-700 hover:underline">Record receipt in {d.currency}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-line-200 p-3">
                <p className="text-caption font-medium text-ink-700">Bills in a foreign currency are each paid on their own, in their currency at the day&apos;s rate: the difference from the booked rate is exchange gain or loss.</p>
                {foreignOpen.map((d) => (
                  <ForeignBillPayment key={d.id} doc={d} onDone={() => { refresh(); void foreignDocs.refetch(); }} />
                ))}
              </div>
            ))}
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <Section title="Notes" description={`Internal: not shown to the ${c.party.toLowerCase()}.`}>
            <textarea className={inputClass} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember about this payment" />
          </Section>
          <Section
            title="Attachments"
            description={`A bank advice, a cheque scan or a remittance. Kept with the ${c.noun} once it is recorded; up to 15 MB each.`}
            actions={
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                <Paperclip size={13} /> Attach files
              </Button>
            }
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                const big = picked.filter((f) => f.size > 15 * 1024 * 1024);
                if (big.length) notify(`${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 15 MB.`, 'error');
                setFiles([...files, ...picked.filter((f) => f.size <= 15 * 1024 * 1024)]);
              }}
            />
            {files.length === 0 ? (
              <p className="text-caption text-ink-400">None.</p>
            ) : (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-caption">
                    <span className="truncate text-ink-700">{f.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-ink-400">
                      {f.size >= 1_048_576 ? `${(f.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                      <button type="button" aria-label={`Remove ${f.name}`} className="hover:text-error-fg" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                        <X size={12} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <Section title="Summary" className="h-fit bg-honey-50/40">
          <dl className="divide-y divide-line-100">
            <div>
              <Row label={c.summaryAmount} value={formatPaise(amountPaise ?? 0)} strong />
              <Row label="Amount used for payments" value={formatPaise(appliedPaise)} />
              {tdsOn && <Row label="TDS deducted" value={formatPaise(tdsPaise)} muted />}
              <Row label="Amount refunded" value={formatPaise(0)} muted />
              <Row
                label="Amount in excess"
                value={excess < 0 ? `−${formatPaise(-excess)}` : formatPaise(excess)}
                tone={excess < 0 ? 'error' : excess > 0 ? 'pending' : undefined}
                strong
              />
            </div>
            {(chargesPaise ?? 0) > 0 && (
              <div className="pt-1">
                <Row label="Bank charges" value={formatPaise(chargesPaise ?? 0)} muted />
                <Row label={isReceipt ? `Reaches ${account?.name ?? 'the bank'}` : `Leaves ${account?.name ?? 'the bank'}`} value={formatPaise(Math.max(0, bankPaise))} />
              </div>
            )}
          </dl>
          {excess > 0 && <p className="mt-3 rounded-md bg-honey-100 px-3 py-2 text-caption text-pending-fg">{formatPaise(excess)} in excess. {c.excess}</p>}
          {excess < 0 && <p className="mt-3 text-caption text-error-fg">More is applied than was {isReceipt ? 'received' : 'paid'}. Lower a payment above, or raise the amount.</p>}
        </Section>
      </div>
    </FormPage>
  );
}
