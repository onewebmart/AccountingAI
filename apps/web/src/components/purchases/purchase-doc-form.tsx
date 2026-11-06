'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useWorkspace } from '@/lib/use-workspace';
import { EntryActions, PartyFound, scanLines, scanTaxable, rupeesOf, useDocumentEntry, usePrefill, type EntryEntity } from '@/components/documents/document-entry';
import { termsDueDate, termsLabel, useTermsDueDate } from '@/components/parties/party-profile';
import { AttachFiles, NumberField, PaymentTermsField, TotalsPanel, termsDays, uploadFiles } from '@/components/sales/sales-doc-parts';
import { previewPricing, type DiscountMode } from '@/components/sales/pricing';
import { FREQUENCY_WORDS, type Frequency } from '@/components/sales/doc-form';
import { TDS_SECTIONS, errorText, formatMinor, shortDate, todayIso, useBills, type BillRecord } from './purchase-data';
import {
  DeliverToField,
  DiscountLevelSwitch,
  PurchaseLinesTable,
  VendorPicker,
  checkPurchaseLines,
  emptyPurchaseLine,
  isBlankPurchaseLine,
  purchaseLineGross,
  purchaseLineToApi,
  useVendorList,
  type DiscountLevel,
  type PurchaseLine,
} from './purchase-doc-parts';

/**
 * One form for every purchase document, laid out like a full purchase
 * document: the vendor, the document's details, the item table, the totals,
 * and the notes, terms and files. Each kind shows the fields it has.
 * Nothing here decides a figure: the server prices the lines, spreads or
 * applies the discount and works out the tax when the document is saved.
 * A purchase order does not post; a bill is a draft until posted from its
 * page; a recurring bill drafts bills on their dates; a vendor credit posts
 * when it is raised.
 */

export type PurchaseDocKind = 'purchase_order' | 'bill' | 'recurring_bill' | 'vendor_credit';

interface KindConfig {
  save: string;
  saving: string;
  list: string;
  /** Kept against a scan it was entered from. */
  entity: EntryEntity | null;
  /** Files can be kept with it. */
  attach: 'PurchaseOrder' | 'PurchaseBill' | 'DebitNote' | null;
  dateLabel: string;
  notesLabel: string;
  notesHint: string;
  foot: string;
  /** Where the discount may be given. */
  levels: DiscountLevel[];
}

const KIND: Record<PurchaseDocKind, KindConfig> = {
  purchase_order: {
    save: 'Raise purchase order', saving: 'Raising…', list: '/purchases/orders', entity: 'PurchaseOrder', attach: 'PurchaseOrder', dateLabel: 'Date',
    notesLabel: 'Notes', notesHint: 'Will be displayed on purchase order.', foot: 'A purchase order does not post. Receive goods against it, then bill it.', levels: ['transaction'],
  },
  bill: {
    save: 'Save bill', saving: 'Saving…', list: '/purchases/bills', entity: 'PurchaseBill', attach: 'PurchaseBill', dateLabel: 'Bill date',
    notesLabel: 'Notes', notesHint: 'Internal. It will not be shown in PDF.', foot: 'Saved as a draft. Nothing reaches the ledger until you post it.', levels: ['transaction', 'line'],
  },
  recurring_bill: {
    save: 'Save recurring bill', saving: 'Saving…', list: '/purchases/recurring-bills', entity: null, attach: null, dateLabel: 'Start on',
    notesLabel: 'Notes', notesHint: 'Internal. Carried onto each bill drafted.', foot: 'Each bill is drafted on its date for you to check and post. Nothing posts on its own.', levels: ['transaction', 'line'],
  },
  vendor_credit: {
    save: 'Post vendor credit', saving: 'Posting…', list: '/purchases/vendor-credits', entity: 'DebitNote', attach: 'DebitNote', dateLabel: 'Vendor credit date',
    notesLabel: 'Notes', notesHint: 'Internal: why it was raised, who collected the goods.', foot: 'A vendor credit posts to the ledger as soon as it is raised.', levels: ['transaction', 'line'],
  },
};

const SHIPMENT = ['Road', 'Courier', 'Hand delivery', 'Rail', 'Air', 'Sea', 'Vendor’s own vehicle', 'Our pickup'];

interface Currency { code: string; name: string; digits: number }
type OrgSettingsView = { displayName?: string | null; address?: string | null };

/** Everything typed but the lines and files: kept whole so it can be set aside while a vendor is added. */
interface FormState {
  vendorId: string;
  ownNumber: boolean;
  number: string;
  /** The vendor's bill number on a bill; the vendor's credit note number on a vendor credit. */
  vendorNumber: string;
  /** Reference# on a PO; Order number on a bill or vendor credit. */
  reference: string;
  date: string;
  /** A PO's delivery date. */
  expectedBy: string;
  terms: string;
  dueDate: string;
  shipment: string;
  deliverTo: { kind: 'organisation' | 'customer'; customerId: string };
  subject: string;
  profileName: string;
  frequency: Frequency;
  endDate: string;
  neverExpires: boolean;
  currency: string;
  fxRate: string;
  reverseCharge: boolean;
  rcIgstPct: number;
  tdsSection: string;
  /** A vendor credit: the bill it corrects, and whether it is typed by lines or as an amount before tax. */
  billId: string;
  creditBy: 'lines' | 'value';
  valueTaxable: string;
  reason: string;
  discountLevel: DiscountLevel;
  discountMode: DiscountMode;
  discount: string;
  adjustmentLabel: string;
  adjustment: string;
  notes: string;
  termsText: string;
}

/** 2026-11-04 → 2026-27. */
const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const WEEKDAY = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const draftKey = (kind: PurchaseDocKind) => `aibooks:purchase-form:${kind}`;
const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

export function PurchaseDocumentForm({ kind }: { kind: PurchaseDocKind }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const entry = useDocumentEntry();
  const workspace = useWorkspace();
  const vendors = useVendorList();
  const k = KIND[kind];
  const today = todayIso();

  const [f, setF] = useState<FormState>(() => ({
    vendorId: params.get('vendorId') ?? '',
    ownNumber: false,
    number: '',
    vendorNumber: '',
    reference: '',
    date: today,
    expectedBy: '',
    terms: kind === 'recurring_bill' ? 'net_15' : '',
    dueDate: '',
    shipment: '',
    deliverTo: { kind: 'organisation', customerId: '' },
    subject: '',
    profileName: '',
    frequency: 'monthly',
    endDate: '',
    neverExpires: true,
    currency: 'INR',
    fxRate: '',
    reverseCharge: false,
    rcIgstPct: 18,
    tdsSection: '',
    billId: params.get('billId') ?? '',
    creditBy: 'lines',
    valueTaxable: '',
    reason: '',
    discountLevel: 'transaction',
    discountMode: 'percent',
    discount: '',
    adjustmentLabel: 'Round off',
    adjustment: '',
    notes: '',
    termsText: '',
  }));
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const [lines, setLines] = useState<PurchaseLine[]>([emptyPurchaseLine()]);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  // Back from adding a vendor: the form as it was, with the new vendor chosen.
  useEffect(() => {
    const kept = sessionStorage.getItem(draftKey(kind));
    if (!kept) return;
    sessionStorage.removeItem(draftKey(kind));
    const vendorId = params.get('vendorId');
    if (!vendorId) return;
    try {
      const saved = JSON.parse(kept) as { f: FormState; lines: PurchaseLine[] };
      setF({ ...saved.f, vendorId });
      if (saved.lines?.length) setLines(saved.lines.map((l) => ({ ...l, key: emptyPurchaseLine().key })));
    } catch {
      // A draft that cannot be read is dropped; the form starts fresh.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // A bill's due date follows its terms and its date, until a due date is typed.
  const dueFromTerms = useTermsDueDate(kind === 'bill' ? f.terms : null, f.date, (dueDate) => set({ dueDate }));

  // From a scan: the vendor, the date, the number and the lines read. A vendor chosen in the link wins.
  usePrefill((x) => {
    setF((s) => {
      const next = { ...s, vendorId: s.vendorId || x.vendor?.id || '' };
      if (x.date) next.date = x.date;
      if (kind === 'bill' && x.number) next.vendorNumber = x.number.slice(0, 40);
      if (kind === 'vendor_credit' && x.number) next.vendorNumber = x.number.slice(0, 40);
      if (kind === 'purchase_order' && x.number) next.reference = x.number.slice(0, 60);
      if (kind === 'bill' && x.dueDate && (!x.date || x.dueDate >= x.date)) next.dueDate = x.dueDate;
      if (kind === 'bill' && x.isReverseCharge) next.reverseCharge = true;
      if (kind === 'vendor_credit') {
        const taxable = scanTaxable(x);
        if (taxable > 0) next.valueTaxable = rupeesOf(taxable);
        next.reason = s.reason || `As per ${x.party.name ?? 'the vendor'}'s credit note${x.number ? ` ${x.number}` : ''}`.slice(0, 300);
      }
      return next;
    });
    // A due date printed on the scan is kept: the terms do not move it.
    if (kind === 'bill' && x.dueDate) dueFromTerms.markTyped();
    const read = scanLines(x);
    if (read.length) setLines(read.map((l) => emptyPurchaseLine(l)));
  });

  const vendor = vendors.list.find((v) => v._id === f.vendorId);

  // ── Bill: a foreign currency, converted once at the day's rate ──
  const currencies = useQuery({ queryKey: ['currency', 'currencies'], queryFn: () => api.get<Currency[]>('/currency/currencies'), retry: false, enabled: kind === 'bill' });
  const foreign = kind === 'bill' && f.currency !== 'INR' ? (currencies.data ?? []).find((c) => c.code === f.currency) ?? null : null;
  const dayRate = useQuery({
    queryKey: ['currency', 'rate', f.currency, f.date],
    queryFn: () => api.get<{ rate: number; date: string } | undefined>(`/currency/rates/on?currency=${f.currency}&date=${f.date}`),
    enabled: !!foreign && /^\d{4}-\d{2}-\d{2}$/.test(f.date),
    retry: false,
  });
  const [rateFor, setRateFor] = useState<string | null>(null);
  useEffect(() => {
    const key = `${f.currency}:${f.date}`;
    if (foreign && dayRate.data && rateFor !== key) {
      set({ fxRate: String(dayRate.data.rate) });
      setRateFor(key);
    }
  }, [foreign, dayRate.data, f.currency, f.date, rateFor]);
  // A vendor who bills in a currency of their own starts the bill in it.
  useEffect(() => {
    if (kind === 'bill' && vendor?.currency && vendor.currency !== 'INR') set({ currency: vendor.currency });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the vendor changes
  }, [vendor?._id]);

  // ── PO: where the goods go ──
  const orgSettings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<OrgSettingsView>('/settings'), enabled: kind === 'purchase_order', retry: false });

  // ── Vendor credit: the bill it corrects ──
  const bills = useBills();
  const vendorBills = useMemo(() => (bills.data ?? []).filter((b) => b.status !== 'draft' && b.vendorId === f.vendorId), [bills.data, f.vendorId]);
  const bill = useQuery({ queryKey: ['purchase', 'bill', f.billId], queryFn: () => api.get<BillRecord>(`/purchase/bills/${f.billId}`), enabled: kind === 'vendor_credit' && !!f.billId });
  const billRow = (bills.data ?? []).find((b) => b._id === f.billId);
  useEffect(() => {
    if (kind === 'vendor_credit' && bill.data && !f.vendorId) set({ vendorId: bill.data.vendorId });
  }, [kind, bill.data, f.vendorId]);
  const billOptions: SearchOption[] = vendorBills.map((b) => ({ value: b._id, label: `${b.billNumber ?? 'No number'} · ${shortDate(b.billDate)}`, detail: formatPaise(b.totalPaise) }));
  const against = kind === 'vendor_credit' ? bill.data : undefined;

  // ── Tax heads: where the vendor is registered against us; a vendor credit as its bill was ──
  const ours = workspace.data?.org.gstin?.slice(0, 2) ?? null;
  const theirs = vendor?.gstin?.slice(0, 2) ?? null;
  const interState = against
    ? against.amountsPaise.igst > 0 || (against.amountsPaise.cgst + against.amountsPaise.sgst === 0 && !!ours && !!theirs && ours !== theirs)
    : !!ours && !!theirs && ours !== theirs;

  const lineLevel = f.discountLevel === 'line' && k.levels.includes('line') && !foreign;
  const filled = lines.filter((l) => !isBlankPurchaseLine(l));
  const pricing = previewPricing(
    filled.map((l) => ({ grossPaise: purchaseLineGross(l, foreign ? foreign.digits : null) ?? 0, taxRatePct: l.taxRatePct, discount: { mode: l.discountMode, value: l.discount } })),
    interState,
    { discountMode: f.discountMode, discount: foreign ? '' : f.discount, adjustment: foreign ? '' : f.adjustment, noTax: !!foreign, lineLevel },
  );
  const shares = new Map(filled.map((l, i) => [l.key, pricing.shares[i] ?? 0]));
  const byValue = kind === 'vendor_credit' && f.creditBy === 'value';
  const valuePaise = parseRupees(f.valueTaxable) ?? 0;
  const valueTax = HEADS.map((h) => (against && against.amountsPaise.taxableValue > 0 ? Math.round((valuePaise * against.amountsPaise[h]) / against.amountsPaise.taxableValue) : 0));
  const valueTotal = valuePaise + valueTax.reduce((s, t) => s + t, 0);
  const owed = billRow?.outstandingPaise ?? 0;
  const fx = Number(f.fxRate);
  const foreignMinor = foreign ? filled.reduce((s, l) => s + (purchaseLineGross(l, foreign.digits) ?? 0), 0) : 0;
  const foreignInr = foreign && fx > 0 ? Math.round((foreignMinor / 10 ** foreign.digits) * fx * 100) : 0;

  // The vendor's agreed terms start the document; changing them on a bill moves the due date until one is typed.
  const pickVendor = (id: string) => {
    const v = vendors.list.find((x) => x._id === id);
    const patch: Partial<FormState> = { vendorId: id };
    if (kind === 'vendor_credit' && id !== f.vendorId) patch.billId = '';
    const agreed = v?.paymentTerms ?? null;
    if (agreed && (kind !== 'recurring_bill' || termsDays(agreed) !== null)) patch.terms = agreed;
    set(patch);
  };
  const setTerms = (terms: string) => set({ terms, ...(kind === 'bill' ? { dueDate: termsDueDate(terms, f.date) ?? f.dueDate } : {}) });
  const agreedTerms = vendor?.paymentTerms ?? null;

  // "+ New vendor": set the form aside, add them, come back with them chosen.
  const here = entry.documentId ? `${pathname}?document=${entry.documentId}` : pathname;
  const newVendorHref = `/purchases/vendors/new?${entry.documentId ? `document=${entry.documentId}&` : ''}returnTo=${encodeURIComponent(here)}`;
  const keepDraft = () => sessionStorage.setItem(draftKey(kind), JSON.stringify({ f, lines }));

  const copyBillLines = () => {
    if (!against) return;
    setLines(
      against.lineItems.map((l) =>
        emptyPurchaseLine({ itemId: l.itemId ?? '', description: l.description, hsnSac: l.hsnSac ?? '', uqc: l.uqc ?? '', qty: String(l.qty), rate: String(l.ratePaise / 100), taxRatePct: l.taxRatePct, accountId: l.accountId ?? '' }),
      ),
    );
    notify('Lines copied from the bill: change them to what is being credited.', 'info');
  };

  // ── Saving ──
  const priced = () => ({
    ...(!lineLevel && pricing.discount ? { discount: pricing.discount } : {}),
    ...(pricing.adjustmentPaise ? { adjustment: { label: f.adjustmentLabel.trim() || 'Adjustment', paise: pricing.adjustmentPaise } } : {}),
  });
  const word = (key: string, v: string, max: number) => (v.trim() ? { [key]: v.trim().slice(0, max) } : {});

  const save = useMutation({
    mutationFn: async (): Promise<{ id: string; label: string; href: string; toast: string }> => {
      if (kind === 'purchase_order') {
        const po = await api.post<{ _id: string; number: string }>('/orders/purchase-orders', {
          vendorId: f.vendorId, ...(f.ownNumber && f.number.trim() ? { number: f.number.trim() } : {}), date: f.date, expectedBy: f.expectedBy || null,
          ...word('referenceNumber', f.reference, 60), ...(f.terms ? { paymentTerms: f.terms } : {}), ...word('shipmentPreference', f.shipment, 60),
          deliverTo: f.deliverTo.kind === 'customer' ? { kind: 'customer', customerId: f.deliverTo.customerId } : { kind: 'organisation' },
          ...word('notes', f.notes, 2000), ...word('termsAndConditions', f.termsText, 3000), ...priced(),
          lines: filled.map((l) => purchaseLineToApi(l, { account: true })),
        });
        return { id: po._id, label: `Purchase order ${po.number}`, href: `/purchases/orders/${po._id}`, toast: `Purchase order ${po.number} raised` };
      }
      if (kind === 'bill') {
        const label = f.vendorNumber.trim() ? `Bill ${f.vendorNumber.trim()}` : `Bill from ${vendor?.name ?? 'the vendor'}`;
        if (foreign) {
          const b = await api.post<{ _id: string }>('/currency/bills', {
            vendorId: f.vendorId, currency: f.currency, ...(f.fxRate.trim() ? { rate: fx } : {}), ...word('billNumber', f.vendorNumber, 40), billDate: f.date, ...(f.dueDate ? { dueDate: f.dueDate } : {}),
            lines: filled.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), rateMinor: purchaseLineGross({ ...l, qty: '1' }, foreign.digits) ?? 0, ...(l.itemId ? { itemId: l.itemId } : {}), ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}), ...(l.projectId ? { projectId: l.projectId } : {}) })),
            reverseChargeIgstPct: f.reverseCharge ? f.rcIgstPct : 0, ...word('notes', f.notes, 1000),
          });
          return { id: b._id, label, href: `/purchases/bills/${b._id}`, toast: 'Bill saved' };
        }
        const b = await api.post<{ _id: string }>('/purchase/bills/from-lines', {
          vendorId: f.vendorId, billNumber: f.vendorNumber.trim() || null, billDate: f.date, dueDate: f.dueDate || null, ...(f.terms ? { paymentTerms: f.terms } : {}),
          ...word('orderNumber', f.reference, 60), ...word('subject', f.subject, 250), ...word('notes', f.notes, 1000), isReverseCharge: f.reverseCharge, ...(f.tdsSection ? { tdsSection: f.tdsSection } : {}),
          ...priced(), lines: filled.map((l) => purchaseLineToApi(l, { account: true, lineDiscount: lineLevel, customer: true, project: true })),
        });
        return { id: b._id, label, href: `/purchases/bills/${b._id}`, toast: 'Bill saved' };
      }
      if (kind === 'recurring_bill') {
        const r = await api.post<{ _id: string; name: string }>('/recurring/bills', {
          name: f.profileName.trim(), partyId: f.vendorId, frequency: f.frequency, dayOfMonth: Number(f.date.slice(8, 10)), startDate: f.date,
          endDate: f.neverExpires ? null : f.endDate || null, dueInDays: termsDays(f.terms) ?? 0, ...(f.terms ? { paymentTerms: f.terms } : {}),
          amountsPaise: { ...pricing.amounts, total: Math.max(1, pricing.amounts.total) }, isReverseCharge: f.reverseCharge,
          ...word('referenceNumber', f.reference, 60), ...word('subject', f.subject, 250), ...word('notes', f.notes, 500), ...priced(),
          lineItems: filled.map((l) => {
            const line = purchaseLineToApi(l, { account: true, lineDiscount: lineLevel, customer: true });
            return { ...line, description: line.description.slice(0, 300), amountPaise: purchaseLineGross(l) ?? 0 };
          }),
        });
        return { id: r._id, label: f.profileName.trim(), href: '/purchases/recurring-bills', toast: `${f.profileName.trim()} scheduled` };
      }
      // A vendor credit: by lines, or by an amount before tax with tax in the bill's proportions.
      if (byValue) {
        const n = await api.post<{ _id: string; noteNumber: string }>(`/purchase/bills/${f.billId}/debit-notes`, { taxableValuePaise: valuePaise, reason: f.reason.trim(), noteDate: f.date });
        return { id: n._id, label: `Vendor credit ${n.noteNumber}`, href: `/purchases/bills/${f.billId}`, toast: `Vendor credit ${n.noteNumber} posted` };
      }
      const n = await api.post<{ _id: string; noteNumber: string }>('/purchase/debit-notes', {
        vendorId: f.vendorId, billId: f.billId, noteDate: f.date, ...word('vendorCreditNumber', f.vendorNumber, 40), ...word('orderNumber', f.reference, 60),
        ...word('subject', f.subject, 250), ...word('reason', f.reason, 300), ...word('notes', f.notes, 2000), ...priced(),
        lines: filled.map((l) => purchaseLineToApi(l, { account: true, lineDiscount: lineLevel })),
      });
      return { id: n._id, label: `Vendor credit ${n.noteNumber}`, href: `/purchases/bills/${f.billId}`, toast: `Vendor credit ${n.noteNumber} posted` };
    },
    onSuccess: async (saved) => {
      for (const key of ['orders', 'purchase', 'recurring', 'currency', 'payments', 'journals', 'gst']) void queryClient.invalidateQueries({ queryKey: [key] });
      if (k.attach && files.length) {
        const failed = await uploadFiles(k.attach, saved.id, files);
        if (failed.length) notify(`${saved.label} is saved, but ${failed.join(', ')} could not be attached. Attach from its page.`, 'error');
      }
      notify(saved.toast);
      return entry.finish(k.entity ? { entityType: k.entity, entityId: saved.id, label: saved.label } : null, saved.href);
    },
  });

  const submit = () => {
    const fail = (p: string) => setProblem(p);
    if (kind === 'recurring_bill' && !f.profileName.trim()) return fail('Give the profile a name, like "Office rent".');
    if (!f.vendorId) return fail('Choose the vendor.');
    if (!f.date) return fail(`Enter the ${k.dateLabel.toLowerCase()}.`);
    if (kind === 'purchase_order') {
      if (f.ownNumber && !f.number.trim()) return fail('Type the purchase order number, or let it be numbered automatically.');
      if (f.expectedBy && f.expectedBy < f.date) return fail('The delivery date is on or after the order date.');
      if (f.deliverTo.kind === 'customer' && !f.deliverTo.customerId) return fail('Choose the customer to deliver to.');
    }
    if (kind === 'bill') {
      if (!f.vendorNumber.trim()) return fail("Enter the vendor's bill number, as printed on their bill.");
      if (f.dueDate && f.dueDate < f.date) return fail('The due date cannot be before the bill date.');
      if (foreign && f.fxRate.trim() && !(fx > 0)) return fail('The rate is rupees for one unit, like 84.1025.');
    }
    if (kind === 'recurring_bill') {
      if (!f.neverExpires && f.endDate && f.endDate < f.date) return fail('It ends before it starts.');
      if (termsDays(f.terms) === null) return fail('Choose the payment terms: each bill is due that many days after its date.');
    }
    if (kind === 'vendor_credit') {
      if (!f.billId) return fail('Choose the bill this vendor credit is against.');
      if (against && f.date < against.billDate) return fail('A vendor credit cannot be dated before its bill.');
      if (byValue) {
        if (!(valuePaise > 0)) return fail('Enter the amount before tax to take off.');
        if (f.reason.trim().length < 3) return fail('Say why the credit is raised, like "Short supply of 10 units".');
        setProblem(null);
        return save.mutate();
      }
    }
    const lineProblem = checkPurchaseLines(lines, foreign ? foreign.digits : null);
    if (lineProblem) return fail(lineProblem);
    if (pricing.discountProblem) return fail(`Discount: ${pricing.discountProblem}`);
    if (pricing.adjustmentProblem) return fail(`Adjustment: ${pricing.adjustmentProblem}`);
    if (kind === 'vendor_credit' && against && pricing.amounts.taxableValue > against.amountsPaise.taxableValue) return fail(`More than the ${formatPaise(against.amountsPaise.taxableValue)} of taxable value the bill was for.`);
    if (!foreign && pricing.amounts.total <= 0) return fail('The lines come to nothing. Enter the rates.');
    setProblem(null);
    save.mutate();
  };

  const dayOfMonth = Number((f.date || today).slice(8, 10));
  const firstRun =
    kind === 'recurring_bill' && f.date
      ? `The first bill is drafted on ${shortDate(f.date)}, then ${
          f.frequency === 'weekly' || f.frequency === 'fortnightly'
            ? `every ${f.frequency === 'weekly' ? '' : 'other '}${WEEKDAY(f.date)}`
            : `on the ${dayOfMonth >= 29 ? `${ordinal(dayOfMonth)} (the month's last day when shorter)` : ordinal(dayOfMonth)} every ${FREQUENCY_WORDS[f.frequency].toLowerCase().replace(/^quarter.*$/, 'quarter')}`
        }${!f.neverExpires && f.endDate ? `, until ${shortDate(f.endDate)}` : ''}.`
      : undefined;
  const supplyNote = foreign
    ? null
    : against
      ? `Taxed as bill ${against.billNumber ?? ''} was: ${interState ? 'IGST' : 'CGST and SGST'}${against.isReverseCharge ? ', under reverse charge' : ''}.`
      : vendor
        ? `${interState ? 'IGST: the vendor is registered in another state.' : 'CGST and SGST: the vendor is in our state, or not registered.'}${f.reverseCharge ? ' Under reverse charge the vendor is owed the amount before tax.' : ''}`
        : null;
  const vendorTds = vendor?.tdsSection ? `${vendor.tdsSection} at ${(vendor.tdsRateBps ?? 0) / 100}%` : null;
  const referenceLabel = kind === 'purchase_order' ? 'Reference#' : 'Order number';

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save it. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? k.saving : k.save}</Button>
          {k.entity && <EntryActions busy={save.isPending} nextLabel={kind === 'vendor_credit' ? 'Post and next' : 'Save and next'} />}
          <Button asChild variant="secondary"><Link href={kind === 'vendor_credit' && params.get('billId') ? `/purchases/bills/${params.get('billId')}` : k.list}>Cancel</Link></Button>
          <p className="text-caption text-ink-500">{k.foot}</p>
        </>
      }
    >
      {/* The vendor band */}
      <Section className="bg-surface-sink/60">
        {k.entity && <PartyFound kind="vendor" chosen={!!f.vendorId} selectId="doc-vendor" />}
        <div className="grid gap-4 md:grid-cols-3">
          {kind === 'recurring_bill' && (
            <Field label="Profile name" required className="md:col-span-3 lg:col-span-1" hint="What you call it: the bills it drafts are listed under it.">
              <input className={inputClass} maxLength={120} value={f.profileName} onChange={(e) => set({ profileName: e.target.value })} placeholder="e.g. Office rent" />
            </Field>
          )}
          <Field label="Vendor name" required className="md:col-span-2">
            <div onClickCapture={(e) => (e.target as HTMLElement).closest('a[href^="/purchases/vendors/new"]') && keepDraft()}>
              <VendorPicker id="doc-vendor" value={f.vendorId} onChange={pickVendor} newHref={newVendorHref} invalid={problem === 'Choose the vendor.'} />
            </div>
          </Field>
          {kind === 'vendor_credit' && (
            <Field
              label="Against bill"
              required
              hint={!f.vendorId ? 'Choose the vendor first.' : billOptions.length === 0 && !bills.isLoading ? 'This vendor has no posted bill. A vendor credit corrects a bill in the books.' : 'GST asks the note to name the bill it corrects.'}
            >
              <SearchSelect value={f.billId} onChange={(billId) => set({ billId })} options={billOptions} disabled={!f.vendorId} placeholder={bills.isLoading ? 'Loading bills…' : 'Choose a posted bill'} searchPlaceholder="Search bill numbers" aria-label="Bill" />
            </Field>
          )}
        </div>
        {kind === 'purchase_order' && (
          <div className="mt-4 max-w-xl">
            <Field label="Delivery address" required>
              <DeliverToField
                value={f.deliverTo}
                onChange={(deliverTo) => set({ deliverTo })}
                org={orgSettings.data ? { name: orgSettings.data.displayName?.trim() || workspace.data?.org.name || 'Your business', address: orgSettings.data.address ?? null } : workspace.data ? { name: workspace.data.org.name, address: null } : null}
              />
            </Field>
          </div>
        )}
        {against && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-200 bg-white px-4 py-3">
            <dl className="flex flex-wrap gap-x-8 gap-y-1 text-body">
              <div><dt className="text-caption text-ink-500">Bill date</dt><dd>{shortDate(against.billDate)}</dd></div>
              <div><dt className="text-caption text-ink-500">Taxable value</dt><dd className="font-mono tabular-nums">{formatPaise(against.amountsPaise.taxableValue)}</dd></div>
              <div><dt className="text-caption text-ink-500">Total</dt><dd className="font-mono tabular-nums">{formatPaise(against.amountsPaise.total)}</dd></div>
              <div><dt className="text-caption text-ink-500">Still owed</dt><dd className="font-mono tabular-nums">{formatPaise(owed)}</dd></div>
            </dl>
            {f.creditBy === 'lines' && against.lineItems.length > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={copyBillLines}><Copy size={13} /> Copy the bill&apos;s lines</Button>
            )}
          </div>
        )}
      </Section>

      {/* The document's details */}
      <Section title={kind === 'recurring_bill' ? 'Schedule and details' : kind === 'purchase_order' ? 'Purchase order details' : kind === 'bill' ? 'Bill details' : 'Vendor credit details'}>
        <div className="grid gap-4 md:grid-cols-3">
          {kind === 'purchase_order' && (
            <NumberField
              label="Purchase order#"
              value={f.number}
              onChange={(number) => set({ number })}
              own={f.ownNumber}
              onOwn={(ownNumber) => set({ ownNumber })}
              autoText={`PO/${fyOf(f.date || today)}/next`}
              hint="The next in the series when you save. The cog types your own."
            />
          )}
          {kind === 'bill' && (
            <Field label="Bill#" required hint="As printed on the vendor's bill.">
              <input className={`${inputClass} font-mono`} maxLength={40} value={f.vendorNumber} onChange={(e) => set({ vendorNumber: e.target.value })} />
            </Field>
          )}
          {kind === 'vendor_credit' && (
            <Field label="Credit note#" hint="The vendor's own credit note number. Ours is the next debit note number, when it posts.">
              <input className={`${inputClass} font-mono`} maxLength={40} value={f.vendorNumber} onChange={(e) => set({ vendorNumber: e.target.value })} />
            </Field>
          )}
          <Field label={referenceLabel} hint={kind === 'purchase_order' ? "The vendor's quotation, or your own reference." : kind === 'bill' ? 'Our purchase order, or the reference the vendor quoted.' : undefined}>
            <input className={`${inputClass} font-mono`} maxLength={60} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
          {kind === 'recurring_bill' && (
            <Field label="Repeat every" required>
              <select className={inputClass} value={f.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
                {(Object.keys(FREQUENCY_WORDS) as Frequency[]).map((fq) => <option key={fq} value={fq}>{FREQUENCY_WORDS[fq]}</option>)}
              </select>
            </Field>
          )}
          <Field label={k.dateLabel} required hint={firstRun}>
            <input type="date" className={inputClass} value={f.date} min={against?.billDate} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          {kind === 'purchase_order' && (
            <Field label="Delivery date">
              <input type="date" className={inputClass} value={f.expectedBy} min={f.date} onChange={(e) => set({ expectedBy: e.target.value })} />
            </Field>
          )}
          {kind === 'recurring_bill' && (
            <Field label="Ends on">
              <div className="space-y-1.5">
                <input type="date" className={inputClass} value={f.neverExpires ? '' : f.endDate} min={f.date} disabled={f.neverExpires} onChange={(e) => set({ endDate: e.target.value })} />
                <label className="flex items-center gap-2 text-caption text-ink-700">
                  <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={f.neverExpires} onChange={(e) => set({ neverExpires: e.target.checked })} />
                  Never expires
                </label>
              </div>
            </Field>
          )}
          {kind === 'bill' && (
            <Field label="Due date">
              <input
                type="date"
                className={inputClass}
                value={f.dueDate}
                min={f.date}
                onChange={(e) => {
                  dueFromTerms.markTyped();
                  set({ dueDate: e.target.value, ...(f.terms !== '' && e.target.value !== termsDueDate(f.terms, f.date) ? { terms: '' } : {}) });
                }}
              />
            </Field>
          )}
          {kind !== 'vendor_credit' && (
            <PaymentTermsField
              value={f.terms}
              onChange={setTerms}
              allowNone={kind !== 'recurring_bill'}
              monthEnd={kind !== 'recurring_bill'}
              hint={agreedTerms && agreedTerms === f.terms ? `${vendor?.name ?? 'The vendor'}'s agreed terms.` : agreedTerms ? `${vendor?.name ?? 'The vendor'} usually has ${termsLabel(agreedTerms) ?? agreedTerms}.` : undefined}
            />
          )}
          {kind === 'purchase_order' && (
            <Field label="Shipment preference">
              <input className={inputClass} list="aibooks-shipment" maxLength={60} value={f.shipment} onChange={(e) => set({ shipment: e.target.value })} placeholder="Choose or type" />
              <datalist id="aibooks-shipment">{SHIPMENT.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          )}
          {kind === 'bill' && (
            <Field label="Currency">
              <select className={inputClass} value={f.currency} onChange={(e) => { set({ currency: e.target.value, fxRate: '' }); setRateFor(null); }}>
                <option value="INR">INR · Indian rupee</option>
                {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
          )}
          {foreign && (
            <Field
              label={`Rate (₹ for 1 ${foreign.code})`}
              hint={dayRate.data ? `The books' rate on ${dayRate.data.date}.` : dayRate.isFetched ? <span>No rate on file for this day: enter it, or add it on <Link href="/currency" className="underline">Foreign currency</Link>.</span> : undefined}
            >
              <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={f.fxRate} onChange={(e) => set({ fxRate: e.target.value })} placeholder="84.1025" />
            </Field>
          )}
          {kind === 'bill' && !foreign && (
            <Field label="TDS on this bill" hint={!f.tdsSection ? (vendorTds ? `The vendor's ${vendorTds} is deducted.` : 'This vendor has no TDS set.') : undefined}>
              <select className={inputClass} value={f.tdsSection} onChange={(e) => set({ tdsSection: e.target.value })}>
                <option value="">As the vendor&apos;s{vendorTds ? ` (${vendorTds})` : ''}</option>
                <option value="none">None on this bill</option>
                {TDS_SECTIONS.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
              </select>
            </Field>
          )}
          {(kind === 'bill' || kind === 'recurring_bill') && (
            <div className="flex flex-col justify-end gap-2 pb-2">
              <label className="flex items-center gap-2 text-body text-ink-900">
                <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={f.reverseCharge} onChange={(e) => set({ reverseCharge: e.target.checked })} />
                {foreign ? 'Imported services: we pay IGST under reverse charge' : 'Reverse charge: we pay the GST'}
              </label>
              {foreign && f.reverseCharge && (
                <select className={`${inputClass} w-40`} value={f.rcIgstPct} onChange={(e) => set({ rcIgstPct: Number(e.target.value) })} aria-label="Reverse-charge IGST rate">
                  {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>IGST {r}%</option>)}
                </select>
              )}
            </div>
          )}
          {kind === 'vendor_credit' && (
            <Field label="Enter it as">
              <div className="flex overflow-hidden rounded-md border border-line-200" role="group" aria-label="Enter the vendor credit as">
                {(['lines', 'value'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set({ creditBy: m })}
                    aria-pressed={f.creditBy === m}
                    className={`flex-1 px-3 py-2 text-caption font-medium ${f.creditBy === m ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-surface-sink'}`}
                  >
                    {m === 'lines' ? 'Item by item' : 'An amount before tax'}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {kind !== 'purchase_order' && !byValue && (
            <Field label="Subject" className="md:col-span-3" hint={kind === 'vendor_credit' ? 'What it is for: also the reason on the voucher when no reason is given.' : 'What this bill is for, in a line.'}>
              <input className={inputClass} maxLength={250} value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
          )}
          {byValue && (
            <Field label="Reason" required className="md:col-span-3">
              <input className={inputClass} maxLength={300} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Short supply of 10 units" />
            </Field>
          )}
        </div>
      </Section>

      {byValue ? (
        <Section title="Amount" description="Takes value off the bill; the tax follows in the bill's own proportions.">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_28rem]">
            <Field label="Amount before tax to take off (₹)" required>
              <input className={`${inputClass} max-w-xs text-right font-mono`} inputMode="decimal" value={f.valueTaxable} onChange={(e) => set({ valueTaxable: e.target.value })} placeholder="0.00" />
            </Field>
            {against && valuePaise > 0 && (
              <dl className="text-body">
                <div className="flex justify-between py-1.5 text-ink-600"><dt>Before tax</dt><dd className="font-mono tabular-nums">{formatPaise(valuePaise)}</dd></div>
                {HEADS.map((h, i) => (valueTax[i] > 0 ? <div key={h} className="flex justify-between py-1.5 text-ink-600"><dt className="uppercase">{h}</dt><dd className="font-mono tabular-nums">{formatPaise(valueTax[i])}</dd></div> : null))}
                <div className="mt-1 flex justify-between border-t border-line-200 pt-3 font-semibold text-ink-900"><dt>Vendor credit total</dt><dd className="font-mono tabular-nums">{formatPaise(valueTotal)}</dd></div>
                {valueTotal > owed && <p className="mt-2 text-caption text-pending-fg">{formatPaise(valueTotal - owed)} more than the bill still owes: that part becomes the vendor&apos;s credit, owed back to you.</p>}
              </dl>
            )}
          </div>
        </Section>
      ) : (
        <>
          <Section
            title="Item table"
            actions={k.levels.length > 1 && !foreign ? <DiscountLevelSwitch value={f.discountLevel} onChange={(discountLevel) => set({ discountLevel })} /> : undefined}
            description={
              foreign
                ? `Prices in ${foreign.code}; converted to rupees once, at the rate.`
                : kind === 'vendor_credit'
                  ? 'What goes back: each line comes back off its account, Purchases unless you choose another.'
                  : 'Pick an item to fill the line with its purchase description and cost price, or type it. Account says where the line is booked.'
            }
          >
            <PurchaseLinesTable
              lines={lines}
              onChange={setLines}
              foreign={foreign ? { currency: foreign.code, digits: foreign.digits } : null}
              lineDiscount={lineLevel}
              showCustomer={kind === 'bill' || kind === 'recurring_bill'}
              showProject={kind === 'bill'}
              shares={shares}
            />
          </Section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_28rem]">
            <Section>
              <div className="space-y-4">
                <Field label={k.notesLabel} hint={k.notesHint}>
                  <textarea className={inputClass} rows={3} maxLength={kind === 'recurring_bill' ? 500 : kind === 'bill' ? 1000 : 2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={kind === 'purchase_order' ? 'Delivery instructions for the vendor' : 'Anything to remember about it'} />
                </Field>
                {kind === 'purchase_order' && (
                  <Field label="Terms & conditions" hint="Printed under the notes.">
                    <textarea className={inputClass} rows={3} maxLength={3000} value={f.termsText} onChange={(e) => set({ termsText: e.target.value })} placeholder="Enter the terms and conditions of your business to be displayed on the purchase order" />
                  </Field>
                )}
                {kind === 'vendor_credit' && (
                  <Field label="Reason" hint="For the voucher. Blank: the subject, or the vendor's credit note number.">
                    <input className={inputClass} maxLength={300} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Two cartons returned" />
                  </Field>
                )}
                {k.attach && (
                  <Field label={kind === 'purchase_order' ? 'Attach file(s) to purchase order' : kind === 'bill' ? 'Attach file(s) to bill' : 'Attach file(s)'}>
                    <AttachFiles files={files} onChange={setFiles} />
                  </Field>
                )}
              </div>
            </Section>
            <Section title="Totals" className="lg:sticky lg:top-20">
              <TotalsPanel
                pricing={pricing}
                interState={interState}
                discount={foreign || lineLevel ? undefined : { mode: f.discountMode, value: f.discount, onMode: (discountMode) => set({ discountMode }), onValue: (discount) => set({ discount }) }}
                adjustment={foreign ? undefined : { label: f.adjustmentLabel, value: f.adjustment, onLabel: (adjustmentLabel) => set({ adjustmentLabel }), onValue: (adjustment) => set({ adjustment }) }}
                foreignTotal={
                  foreign ? (
                    <>
                      <div className="flex justify-between py-1.5"><dt className="text-body text-ink-600">In {foreign.code}</dt><dd className="font-mono tabular-nums">{formatMinor(foreignMinor, foreign.code, foreign.digits)}</dd></div>
                      <div className="mt-1 flex justify-between border-t border-line-200 pt-3 font-semibold">
                        <dt className="text-body">In rupees, before tax</dt>
                        <dd className="font-mono tabular-nums">{fx > 0 ? formatPaise(foreignInr) : '—'}</dd>
                      </div>
                      {f.reverseCharge && f.rcIgstPct > 0 && fx > 0 && (
                        <p className="mt-1 text-caption text-ink-500">IGST {f.rcIgstPct}% under reverse charge: {formatPaise(Math.round((foreignInr * f.rcIgstPct) / 100))}, ours to pay and claim.</p>
                      )}
                    </>
                  ) : undefined
                }
                supplyNote={supplyNote}
              />
              {kind === 'vendor_credit' && against && pricing.amounts.total > owed && (
                <p className="mt-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
                  {formatPaise(pricing.amounts.total - owed)} more than the bill still owes: that part becomes the vendor&apos;s credit, to set against their next bill or have refunded.
                </p>
              )}
              {kind === 'recurring_bill' && pricing.amounts.total > 0 && (
                <p className="mt-3 text-caption text-ink-500">Each bill drafted comes to <span className="font-mono tabular-nums text-ink-900">{formatPaise(pricing.amounts.total)}</span>.</p>
              )}
            </Section>
          </div>
        </>
      )}
    </FormPage>
  );
}
