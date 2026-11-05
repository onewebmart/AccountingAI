'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { useWorkspace } from '@/lib/use-workspace';
import { AmountsSummary, BillLineEditor, billLinesToApi, emptyBillLine, foreignLinesToApi, previewAmounts, type BillEditLine } from '@/components/purchases/bill-lines';
import { TDS_SECTIONS, errorText, formatMinor, parseMinor, todayIso, useVendors } from '@/components/purchases/purchase-data';
import { DocumentEntry, EntryActions, PartyFound, scanLines, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

interface Currency { code: string; name: string; digits: number }

type Params = { vendorId?: string; document?: string };

/** Opened from a scanned bill (?document=), the file shows beside the form, which starts filled from it. */
export default function NewBillPage({ searchParams }: { searchParams: Params }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <NewBillForm searchParams={searchParams} />
    </DocumentEntry>
  );
}

/**
 * A bill typed line by line. In rupees it is priced on the server from its
 * lines; in a foreign currency it is converted once at the day's rate, with
 * reverse-charge IGST for imported services. Either way it is saved as a
 * draft, to check and then post to the ledger.
 */
function NewBillForm({ searchParams }: { searchParams: Params }) {
  const qc = useQueryClient();
  const entry = useDocumentEntry();
  const vendors = useVendors();
  const workspace = useWorkspace();
  const currencies = useQuery({ queryKey: ['currency', 'currencies'], queryFn: () => api.get<Currency[]>('/currency/currencies'), retry: false });

  const [vendorId, setVendorId] = useState(searchParams.vendorId ?? '');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [rate, setRate] = useState('');
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [rcIgstPct, setRcIgstPct] = useState(18);
  const [tdsSection, setTdsSection] = useState('');
  const [lines, setLines] = useState<BillEditLine[]>([emptyBillLine()]);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const vendor = (vendors.data ?? []).find((v) => v._id === vendorId);
  const foreign = currency !== 'INR' ? (currencies.data ?? []).find((c) => c.code === currency) ?? null : null;

  // From a scan: what was read, for the person to check. A vendor chosen in the link wins.
  usePrefill((x) => {
    setVendorId((v) => v || x.vendor?.id || '');
    if (x.number) setBillNumber(x.number.slice(0, 40));
    if (x.date) setBillDate(x.date);
    if (x.dueDate && (!x.date || x.dueDate >= x.date)) setDueDate(x.dueDate);
    if (x.isReverseCharge) setReverseCharge(true);
    const read = scanLines(x);
    if (read.length) setLines(read.map((l) => ({ ...emptyBillLine(), ...l })));
  });

  // A vendor who bills in a currency of their own starts the bill in it.
  useEffect(() => {
    if (vendor?.currency && vendor.currency !== 'INR') setCurrency(vendor.currency);
  }, [vendor?._id, vendor?.currency]);

  // The day's rate, from the rates the books hold; it can be changed.
  const dayRate = useQuery({
    queryKey: ['currency', 'rate', currency, billDate],
    queryFn: () => api.get<{ rate: number; date: string } | undefined>(`/currency/rates/on?currency=${currency}&date=${billDate}`),
    enabled: !!foreign && /^\d{4}-\d{2}-\d{2}$/.test(billDate),
    retry: false,
  });
  useEffect(() => {
    const key = `${currency}:${billDate}`;
    if (foreign && dayRate.data && rateFor !== key) {
      setRate(String(dayRate.data.rate));
      setRateFor(key);
    }
  }, [foreign, dayRate.data, currency, billDate, rateFor]);

  const ours = workspace.data?.org.gstin?.slice(0, 2) ?? null;
  const theirs = vendor?.gstin?.slice(0, 2) ?? null;
  const interState = !!ours && !!theirs && ours !== theirs;
  const preview = previewAmounts(lines, interState);
  const rateNumber = Number(rate);
  const foreignMinor = foreign
    ? lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (parseMinor(l.rate || '0', foreign.digits) ?? 0)), 0)
    : 0;
  const foreignInrPaise = foreign && rateNumber > 0 ? Math.round((foreignMinor / 10 ** foreign.digits) * rateNumber * 100) : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!vendorId) throw new Error('Choose the vendor.');
      if (dueDate && dueDate < billDate) throw new Error('The due date is before the bill date.');
      if (foreign) {
        const parsed = foreignLinesToApi(lines, foreign.digits);
        if (!parsed.ok) throw new Error(parsed.problem);
        if (rate.trim() && !(rateNumber > 0)) throw new Error('The rate is rupees for one unit, like 84.1025.');
        return api.post<{ _id: string }>('/currency/bills', {
          vendorId,
          currency,
          ...(rate.trim() ? { rate: rateNumber } : {}),
          ...(billNumber.trim() ? { billNumber: billNumber.trim() } : {}),
          billDate,
          ...(dueDate ? { dueDate } : {}),
          lines: parsed.lines.map((l) => ({ description: l.description, qty: l.qty, rateMinor: l.rateMinor, ...(l.itemId ? { itemId: l.itemId } : {}), ...(l.hsnSac ? { hsnSac: l.hsnSac } : {}), ...(l.projectId ? { projectId: l.projectId } : {}) })),
          reverseChargeIgstPct: reverseCharge ? rcIgstPct : 0,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
      }
      const parsed = billLinesToApi(lines);
      if (!parsed.ok) throw new Error(parsed.problem);
      return api.post<{ _id: string }>('/purchase/bills/from-lines', {
        vendorId,
        billNumber: billNumber.trim() || null,
        billDate,
        dueDate: dueDate || null,
        lines: parsed.lines,
        notes: notes.trim() || null,
        isReverseCharge: reverseCharge,
        ...(tdsSection ? { tdsSection } : {}),
      });
    },
    onSuccess: (bill) => {
      void qc.invalidateQueries({ queryKey: ['purchase'] });
      void qc.invalidateQueries({ queryKey: ['currency'] });
      notify('Bill saved');
      // From a scan: the file is kept with the bill first. Otherwise, straight to the bill.
      const label = billNumber.trim() ? `Bill ${billNumber.trim()}` : `Bill from ${vendor?.name ?? 'the vendor'}`;
      return entry.finish({ entityType: 'PurchaseBill', entityId: bill._id, label }, `/purchases/bills/${bill._id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the bill. Try again.")),
  });

  const vendorTds = vendor?.tdsSection ? `${vendor.tdsSection} at ${(vendor.tdsRateBps ?? 0) / 100}%` : null;

  return (
    <div>
      <PageHeader title="New bill" subtitle="Saved as a draft. Nothing reaches the ledger until you post it." back={{ href: '/purchases/bills', label: 'Bills' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          save.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save bill'}</Button>
            <EntryActions busy={save.isPending} />
            <Button type="button" variant="secondary" asChild>
              <Link href="/purchases/bills">Cancel</Link>
            </Button>
          </>
        }
      >
        <Section title="Bill">
          <PartyFound kind="vendor" chosen={!!vendorId} selectId="bill-vendor" />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Vendor" required className="md:col-span-2" hint={vendors.data?.length === 0 ? <Link href="/purchases/vendors/new" className="underline">Add a vendor first</Link> : vendor?.gstin ? <span className="font-mono">{vendor.gstin}</span> : vendor ? 'Not registered for GST' : undefined}>
              <select id="bill-vendor" className={inputClass} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{vendors.isLoading ? 'Loading…' : 'Choose a vendor…'}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v._id} value={v._id}>{v.name}{v.gstin ? ` · ${v.gstin}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Bill number" hint="As printed on the vendor's bill.">
              <input className={`${inputClass} font-mono`} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} maxLength={40} />
            </Field>
            <Field label="Bill date" required>
              <input type="date" className={inputClass} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Due date">
              <input type="date" className={inputClass} value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Currency">
              <select className={inputClass} value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(''); setRateFor(null); }}>
                <option value="INR">INR · Indian rupee</option>
                {(currencies.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {foreign && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field
                label={`Rate (₹ for 1 ${foreign.code})`}
                hint={dayRate.data ? `The books' rate on ${dayRate.data.date}.` : dayRate.isFetched ? <span>No rate on file for this day: enter it, or add it on <Link href="/currency" className="underline">Foreign currency</Link>.</span> : undefined}
              >
                <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="84.1025" />
              </Field>
              <div className="md:col-span-2">
                <label className="mt-6 flex items-center gap-2 text-body text-ink-900">
                  <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
                  Imported services: we pay IGST under reverse charge
                </label>
                {reverseCharge && (
                  <select className={`${inputClass} mt-2 w-40`} value={rcIgstPct} onChange={(e) => setRcIgstPct(Number(e.target.value))} aria-label="Reverse-charge IGST rate">
                    {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>IGST {r}%</option>)}
                  </select>
                )}
              </div>
            </div>
          )}

          {!foreign && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="flex items-center gap-2 text-body text-ink-900 md:col-span-2">
                <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
                Reverse charge: we pay the GST on this purchase
              </label>
              <Field label="TDS on this bill" hint={!tdsSection ? (vendorTds ? `The vendor's ${vendorTds} is deducted.` : 'This vendor has no TDS set.') : undefined}>
                <select className={inputClass} value={tdsSection} onChange={(e) => setTdsSection(e.target.value)}>
                  <option value="">As the vendor's{vendorTds ? ` (${vendorTds})` : ''}</option>
                  <option value="none">None on this bill</option>
                  {TDS_SECTIONS.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
                </select>
              </Field>
            </div>
          )}
        </Section>

        <Section title="Lines" description={foreign ? `Prices in ${foreign.code}; converted to rupees once, at the rate.` : 'Pick an item to fill a line, or type it. The server works out the tax.'}>
          <BillLineEditor lines={lines} onChange={setLines} foreign={foreign ? { currency: foreign.code, digits: foreign.digits } : null} showAccount />
          <div className="mt-4 border-t border-line-100 pt-4">
            {foreign ? (
              <div className="ml-auto w-full max-w-xs text-body">
                <div className="flex justify-between py-1 text-ink-600"><span>In {foreign.code}</span><span className="font-mono">{formatMinor(foreignMinor, foreign.code, foreign.digits)}</span></div>
                <div className="flex justify-between border-t border-line-200 pt-2 font-semibold text-ink-900"><span>In rupees, before tax</span><span className="font-mono">{rateNumber > 0 ? formatPaise(foreignInrPaise) : '—'}</span></div>
                {reverseCharge && rcIgstPct > 0 && rateNumber > 0 && (
                  <p className="mt-1 text-caption text-ink-500">IGST {rcIgstPct}% under reverse charge: {formatPaise(Math.round((foreignInrPaise * rcIgstPct) / 100))}, ours to pay and claim.</p>
                )}
              </div>
            ) : (
              <AmountsSummary
                amounts={preview}
                note={
                  <>
                    {interState ? 'IGST: the vendor is registered in another state.' : 'CGST and SGST: the vendor is in our state, or not registered.'}
                    {reverseCharge ? ' Under reverse charge the vendor is owed the amount before tax.' : ''}
                  </>
                }
              />
            )}
          </div>
        </Section>

        <Section title="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember about this bill" />
        </Section>
      </FormPage>
    </div>
  );
}
