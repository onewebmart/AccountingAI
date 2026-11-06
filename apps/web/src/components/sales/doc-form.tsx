'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { useProjects } from '@/components/projects/project-select';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { EntryActions, PartyFound, scanLines, useDocumentEntry, usePrefill, type EntryEntity } from '@/components/documents/document-entry';
import { termsDueDate, termsLabel, useTermsDueDate, type PartyProfile } from '@/components/parties/party-profile';
import { addDays, errorText, formatMinor, shortDate, stateName, toMinor, todayIst, useCustomerInvoices, useCustomers, useSupply, type CustomerRow, type InvoiceRecord } from './sales-data';
import { previewPricing, type DiscountMode } from './pricing';
import {
  AttachFiles,
  CustomerPicker,
  NumberField,
  PaymentTermsField,
  SaleLinesTable,
  SalespersonField,
  TotalsPanel,
  checkLines,
  emptySaleLine,
  isBlankLine,
  lineGross,
  rememberSalesperson,
  termsDays,
  uploadFiles,
  useSalesAccountId,
  type LineMoney,
  type SaleLine,
} from './sales-doc-parts';

/**
 * One form for every sales document, laid out like a full sales document:
 * the customer, the document's details, the item table, the totals, and the
 * notes, terms and files. Each kind shows the fields it has. Nothing here
 * decides a figure: the server prices the lines, spreads the discount and
 * works out the tax when the document is saved. Only a credit note posts,
 * when a person raises it; everything else is a draft or does not post.
 */

export type SalesDocKind = 'quote' | 'order' | 'invoice' | 'recurring' | 'challan' | 'credit_note';

interface KindConfig {
  save: string;
  saving: string;
  saved: string;
  list: string;
  /** Kept against a scan it was entered from. */
  entity: EntryEntity | null;
  label: string;
  numberLabel: string;
  prefix: string | null;
  dateLabel: string;
  /** Files can be kept with it. */
  attach: 'Quote' | 'SalesOrder' | 'SalesInvoice' | null;
  notes: string;
  notesHint: string;
  foot: string;
}

const KIND: Record<SalesDocKind, KindConfig> = {
  quote: {
    save: 'Save quote', saving: 'Saving…', saved: 'Quote saved', list: '/sales/quotes', entity: 'Quote', label: 'Quote', numberLabel: 'Quote#', prefix: 'QT', dateLabel: 'Quote date',
    attach: 'Quote', notes: 'Looking forward to your business.', notesHint: 'Printed on the quote.', foot: 'A quote does not post. Accepted, it becomes an order or a draft invoice.',
  },
  order: {
    save: 'Save sales order', saving: 'Saving…', saved: 'Sales order saved', list: '/sales/orders', entity: 'SalesOrder', label: 'Sales order', numberLabel: 'Sales order#', prefix: 'SO', dateLabel: 'Sales order date',
    attach: 'SalesOrder', notes: '', notesHint: 'Printed on the order.', foot: 'An order does not post. Invoice it in parts as you deliver.',
  },
  invoice: {
    save: 'Save invoice', saving: 'Saving…', saved: 'Invoice saved', list: '/sales/invoices', entity: 'SalesInvoice', label: 'Invoice', numberLabel: 'Invoice#', prefix: 'INV', dateLabel: 'Invoice date',
    attach: 'SalesInvoice', notes: 'Thanks for your business.', notesHint: 'Printed on the invoice.', foot: 'Saved as a draft. Nothing reaches the ledger until you post it.',
  },
  recurring: {
    save: 'Save recurring invoice', saving: 'Saving…', saved: 'Recurring invoice saved', list: '/sales/recurring-invoices', entity: null, label: 'Recurring invoice', numberLabel: '', prefix: null, dateLabel: 'Start on',
    attach: null, notes: '', notesHint: 'Carried onto each invoice drafted.', foot: 'Each invoice is drafted on its date for you to check and post. Nothing posts on its own.',
  },
  challan: {
    save: 'Issue challan', saving: 'Issuing…', saved: 'Challan issued', list: '/sales/challans', entity: null, label: 'Delivery challan', numberLabel: 'Delivery challan#', prefix: 'DC', dateLabel: 'Challan date',
    attach: null, notes: '', notesHint: 'Printed on the challan.', foot: 'A challan does not post: goods sent under it are invoiced separately.',
  },
  credit_note: {
    save: 'Post credit note', saving: 'Posting…', saved: 'Credit note posted', list: '/sales/credit-notes', entity: null, label: 'Credit note', numberLabel: 'Credit note#', prefix: 'CRN', dateLabel: 'Credit note date',
    attach: null, notes: '', notesHint: 'Printed on the credit note.', foot: 'A credit note posts to the ledger as soon as it is raised.',
  },
};

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'bimonthly' | 'quarterly' | 'half_yearly' | 'yearly';
export const FREQUENCY_WORDS: Record<Frequency, string> = {
  weekly: 'Week',
  fortnightly: '2 weeks',
  monthly: 'Month',
  bimonthly: '2 months',
  quarterly: 'Quarter (3 months)',
  half_yearly: '6 months',
  yearly: 'Year',
};

export const CHALLAN_TYPES: Array<[string, string]> = [
  ['liquid_gas', 'Supply of liquid gas'],
  ['job_work', 'Job work'],
  ['approval', 'Supply on approval'],
  ['supply', 'Supply, invoiced later'],
  ['other', 'Others'],
];

const DELIVERY_METHODS = ['Courier', 'Our own vehicle', 'Transporter', 'Customer pickup', 'Hand delivery', 'Post'];

interface Currency { code: string; name: string; digits: number }

/** An invoice as stored, with the account each line posted to. */
type InvoiceWithAccounts = Omit<InvoiceRecord, 'lineItems'> & { lineItems: Array<InvoiceRecord['lineItems'][number] & { accountId?: string | null }> };

/** Everything typed into the form but the lines and files: kept whole so it can be set aside while a customer is added. */
interface FormState {
  customerId: string;
  ownNumber: boolean;
  number: string;
  reference: string;
  date: string;
  validUntil: string;
  expectedBy: string;
  /** Payment terms as customers carry them: due_on_receipt, net_<days>, end_of_month, end_of_next_month; blank for none. */
  terms: string;
  dueDate: string;
  deliveryMethod: string;
  salesperson: string;
  projectId: string;
  subject: string;
  currency: string;
  rate: string;
  shipping: { number: string; date: string; portCode: string };
  profileName: string;
  frequency: Frequency;
  endDate: string;
  neverExpires: boolean;
  reason: string;
  vehicleNo: string;
  invoiceId: string;
  noteReason: string;
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

const draftKey = (kind: SalesDocKind) => `aibooks:sales-form:${kind}`;

export function SalesDocumentForm({ kind }: { kind: SalesDocKind }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const projects = useProjects();
  const entry = useDocumentEntry();
  const salesAccount = useSalesAccountId();
  const k = KIND[kind];
  const today = todayIst();

  const [f, setF] = useState<FormState>(() => ({
    customerId: params.get('customerId') ?? '',
    ownNumber: false,
    number: '',
    reference: '',
    date: today,
    validUntil: addDays(today, 15),
    expectedBy: '',
    terms: kind === 'invoice' || kind === 'recurring' ? 'net_15' : '',
    dueDate: addDays(today, 15),
    deliveryMethod: '',
    salesperson: '',
    projectId: '',
    subject: '',
    currency: 'INR',
    rate: '',
    shipping: { number: '', date: '', portCode: '' },
    profileName: '',
    frequency: 'monthly',
    endDate: '',
    neverExpires: true,
    reason: '',
    vehicleNo: '',
    invoiceId: params.get('invoiceId') ?? '',
    noteReason: '',
    discountMode: 'percent',
    discount: '',
    adjustmentLabel: kind === 'invoice' || kind === 'recurring' ? 'Round off' : 'Adjustment',
    adjustment: '',
    notes: k.notes,
    termsText: '',
  }));
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const [lines, setLines] = useState<SaleLine[]>([emptySaleLine()]);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  // Back from adding a customer: the form as it was, with the new customer chosen.
  useEffect(() => {
    const kept = sessionStorage.getItem(draftKey(kind));
    if (!kept) return;
    sessionStorage.removeItem(draftKey(kind));
    const customerId = params.get('customerId');
    if (!customerId) return;
    try {
      const saved = JSON.parse(kept) as { f: FormState; lines: SaleLine[] };
      setF({ ...saved.f, customerId });
      if (saved.lines?.length) setLines(saved.lines.map((l) => ({ ...l, key: emptySaleLine().key })));
    } catch {
      // A draft that cannot be read is dropped; the form starts fresh.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // The invoice's due date follows its terms (the customer's, once one is chosen) and its date, until a due date is typed.
  const dueFromTerms = useTermsDueDate(kind === 'invoice' ? f.terms : null, f.date, (dueDate) => set({ dueDate }));

  // From a scan: the customer, the date and the lines read; a customer's PO number on an order; the number only off an invoice of ours.
  usePrefill((x) => {
    setF((s) => {
      const next = { ...s, customerId: s.customerId || x.customer?.id || '' };
      if (x.date) {
        next.date = x.date;
        if (kind === 'quote') next.validUntil = addDays(x.date, 15);
        if (kind === 'invoice' && x.dueDate && x.dueDate >= x.date) next.dueDate = x.dueDate;
      } else if (kind === 'invoice' && x.dueDate) next.dueDate = x.dueDate;
      if (kind === 'order' && x.number) next.reference = x.number.slice(0, 60);
      if (kind === 'invoice' && x.documentType === 'sales_invoice' && x.number) {
        next.ownNumber = true;
        next.number = x.number.replace(/[^A-Za-z0-9/-]/g, '').slice(0, 16);
      }
      return next;
    });
    // A due date printed on the scan is kept: the terms do not move it.
    if (kind === 'invoice' && x.dueDate) dueFromTerms.markTyped();
    const read = scanLines(x);
    if (read.length) setLines(read.map((l) => emptySaleLine(l)));
  });

  // ── Invoice: currency, for an export ──
  const currencies = useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies'), retry: false, enabled: kind === 'invoice' });
  const foreign = kind === 'invoice' && f.currency !== 'INR';
  const digits = currencies.data?.find((c) => c.code === f.currency)?.digits ?? 2;
  const money: LineMoney = foreign ? { kind: 'foreign', currency: f.currency, digits } : { kind: 'inr' };
  const storedRate = useQuery({
    queryKey: ['currency', 'on', f.currency, f.date],
    queryFn: () => api.get<{ rate: number; date: string } | null>(`/currency/rates/on?currency=${f.currency}&date=${f.date}`),
    enabled: foreign && !!f.date,
    retry: false,
  });
  useEffect(() => {
    if (storedRate.data) set({ rate: String(storedRate.data.rate) });
  }, [storedRate.data]);

  // ── Credit note: the invoice it is against ──
  const customerInvoices = useCustomerInvoices(kind === 'credit_note' ? f.customerId : '');
  const invoice = useQuery({
    queryKey: ['sales', 'invoice', f.invoiceId],
    queryFn: () => api.get<InvoiceWithAccounts>(`/sales/invoices/${f.invoiceId}`),
    enabled: kind === 'credit_note' && !!f.invoiceId,
  });
  // Linked from an invoice: its customer is the note's.
  useEffect(() => {
    if (invoice.data && !f.customerId) set({ customerId: invoice.data.customerId });
  }, [invoice.data, f.customerId]);
  const invoiceOptions: SearchOption[] = useMemo(() => {
    const rows = (customerInvoices.data ?? []).filter((i) => i.status === 'posted' || i.status === 'paid');
    const opts = rows.map((i) => ({ value: i._id, label: `${i.invoiceNumber ?? 'Not numbered'} · ${shortDate(i.invoiceDate)}`, detail: formatPaise(i.totalPaise) }));
    if (f.invoiceId && invoice.data && !opts.some((o) => o.value === f.invoiceId)) {
      opts.unshift({ value: f.invoiceId, label: `${invoice.data.invoiceNumber ?? 'Not numbered'} · ${shortDate(invoice.data.invoiceDate)}`, detail: formatPaise(invoice.data.amountsPaise.total) });
    }
    return opts;
  }, [customerInvoices.data, f.invoiceId, invoice.data]);
  const inv = kind === 'credit_note' ? invoice.data : undefined;
  const owed = inv ? Math.max(0, inv.amountsPaise.total - (inv.amountPaidPaise ?? 0) - (inv.adjustedPaise ?? 0)) : 0;

  // ── Tax heads: the customer's state, or for a credit note what its invoice charged ──
  const supply = useSupply(foreign ? '' : f.customerId);
  const interState = inv
    ? inv.amountsPaise.igst > 0 || (inv.amountsPaise.cgst + inv.amountsPaise.sgst === 0 && (supply.data?.interState ?? false))
    : supply.data?.interState ?? false;
  const customer = customers.data?.find((c) => c._id === f.customerId);

  const filled = lines.filter((l) => !isBlankLine(l));
  const pricing = previewPricing(
    filled.map((l) => ({ grossPaise: lineGross(l, money) ?? 0, taxRatePct: l.taxRatePct })),
    interState,
    { discountMode: f.discountMode, discount: kind === 'challan' || foreign ? '' : f.discount, adjustment: kind === 'challan' || kind === 'credit_note' || foreign ? '' : f.adjustment, noTax: foreign },
  );
  const shares = new Map(filled.map((l, i) => [l.key, pricing.shares[i] ?? 0]));
  const foreignTotal = foreign ? filled.reduce((s, l) => s + (lineGross(l, money) ?? 0), 0) : 0;
  const rateNumber = Number(f.rate);

  // A customer billed in their own currency starts in it.
  const pickCustomer = (id: string) => {
    const patch: Partial<FormState> = { customerId: id };
    if (kind === 'credit_note' && id !== f.customerId) patch.invoiceId = '';
    const c = customers.data?.find((x) => x._id === id) as (CustomerRow & PartyProfile) | undefined;
    if (kind === 'invoice' && c?.currency && c.currency !== 'INR' && currencies.data?.some((x) => x.code === c.currency)) patch.currency = c.currency;
    // The customer's agreed terms: any on an invoice, where the due date can say it; a number of days on an order or schedule.
    const agreed = c?.paymentTerms;
    if (agreed && (kind === 'invoice' || ((kind === 'order' || kind === 'recurring') && termsDays(agreed) !== null))) patch.terms = agreed;
    set(patch);
  };

  // Choosing terms sets the due date; a due date typed by hand is the person's.
  const setTerms = (terms: string) => set({ terms, ...(kind === 'invoice' ? { dueDate: termsDueDate(terms, f.date) ?? f.dueDate } : {}) });
  const setDate = (date: string) => set({ date, ...(kind === 'quote' && f.validUntil < date ? { validUntil: addDays(date, 15) } : {}) });
  const agreedTerms = (customer as (CustomerRow & PartyProfile) | undefined)?.paymentTerms ?? null;

  // "+ New customer": set the form aside, add them, come back with them chosen.
  const here = entry.documentId ? `${pathname}?document=${entry.documentId}` : pathname;
  const newCustomerHref = `/sales/customers/new?${entry.documentId ? `document=${entry.documentId}&` : ''}returnTo=${encodeURIComponent(here)}`;
  const keepDraft = () => sessionStorage.setItem(draftKey(kind), JSON.stringify({ f, lines }));

  const copyInvoiceLines = () => {
    if (!inv) return;
    setLines(
      inv.lineItems.map((l) =>
        emptySaleLine({
          itemId: l.itemId ?? '',
          description: l.description,
          hsnSac: l.hsnSac ?? '',
          uqc: l.uqc ?? '',
          qty: String(l.qty),
          rate: String(l.ratePaise / 100),
          taxRatePct: l.taxRatePct,
          accountId: l.accountId ?? '',
        }),
      ),
    );
    notify('Lines copied from the invoice: change them to what is being credited.', 'info');
  };

  // ── Saving ──
  const inrLine = (l: SaleLine) => ({
    description: l.description.trim(),
    ...(l.itemId ? { itemId: l.itemId } : {}),
    ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
    ...(l.uqc ? { uqc: l.uqc } : {}),
    qty: Number(l.qty),
    ratePaise: parseRupees(l.rate || '0') ?? 0,
    taxRatePct: l.taxRatePct,
  });
  const words = () => ({
    ...(f.subject.trim() ? { subject: f.subject.trim() } : {}),
    ...(f.salesperson.trim() ? { salespersonName: f.salesperson.trim() } : {}),
    ...(f.termsText.trim() ? { termsAndConditions: f.termsText.trim() } : {}),
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
  });
  const priced = () => ({
    ...(pricing.discount ? { discount: pricing.discount } : {}),
    ...(pricing.adjustmentPaise ? { adjustment: { label: f.adjustmentLabel.trim() || 'Adjustment', paise: pricing.adjustmentPaise } } : {}),
  });
  const typedNumber = f.ownNumber && f.number.trim() ? f.number.trim() : undefined;

  const save = useMutation({
    mutationFn: async (): Promise<{ id: string; label: string; href: string }> => {
      const apiLines = filled.map(inrLine);
      if (kind === 'quote') {
        const q = await api.post<{ _id: string; number: string }>('/orders/quotes', {
          customerId: f.customerId, number: typedNumber, date: f.date, validUntil: f.validUntil || undefined, ...(f.projectId ? { projectId: f.projectId } : {}),
          ...(f.reference.trim() ? { referenceNumber: f.reference.trim() } : {}), ...words(), ...priced(), lines: apiLines,
        });
        return { id: q._id, label: `Quote ${q.number}`, href: `/sales/quotes/${q._id}` };
      }
      if (kind === 'order') {
        const o = await api.post<{ _id: string; number: string }>('/orders/sales-orders', {
          customerId: f.customerId, number: typedNumber, date: f.date, ...(f.expectedBy ? { expectedBy: f.expectedBy } : {}), customerPoNumber: f.reference.trim() || null,
          ...(f.deliveryMethod.trim() ? { deliveryMethod: f.deliveryMethod.trim() } : {}), ...(termsDays(f.terms) !== null ? { paymentTermsDays: termsDays(f.terms) } : {}), ...words(), ...priced(), lines: apiLines,
        });
        return { id: o._id, label: `Sales order ${o.number}`, href: `/sales/orders/${o._id}` };
      }
      if (kind === 'challan') {
        const c = await api.post<{ _id: string; number: string }>('/orders/challans', {
          customerId: f.customerId, number: typedNumber, date: f.date, reason: f.reason, vehicleNo: f.vehicleNo.trim() || null,
          ...(f.reference.trim() ? { referenceNumber: f.reference.trim() } : {}), ...words(), lines: apiLines,
        });
        return { id: c._id, label: `Challan ${c.number}`, href: `/sales/challans/${c._id}` };
      }
      if (kind === 'credit_note') {
        const n = await api.post<{ _id: string; noteNumber: string }>('/sales/credit-notes', {
          customerId: f.customerId, invoiceId: f.invoiceId, noteDate: f.date, reason: f.noteReason.trim(),
          ...(f.reference.trim() ? { referenceNumber: f.reference.trim() } : {}), ...words(), ...(pricing.discount ? { discount: pricing.discount } : {}),
          lines: filled.map((l) => ({ ...inrLine(l), ...((l.accountId || salesAccount) ? { accountId: l.accountId || salesAccount } : {}) })),
        });
        return { id: n._id, label: `Credit note ${n.noteNumber}`, href: '/sales/credit-notes' };
      }
      if (kind === 'recurring') {
        const r = await api.post<{ _id: string; name: string }>('/recurring/invoices', {
          name: f.profileName.trim(), partyId: f.customerId, frequency: f.frequency, dayOfMonth: Number(f.date.slice(8, 10)), startDate: f.date,
          endDate: f.neverExpires ? null : f.endDate || null, dueInDays: termsDays(f.terms) ?? 0, amountsPaise: pricing.amounts,
          lineItems: filled.map((l) => ({ ...inrLine(l), amountPaise: lineGross(l) ?? 0 })),
          ...(f.reference.trim() ? { referenceNumber: f.reference.trim() } : {}), ...words(), ...priced(),
        });
        return { id: r._id, label: f.profileName.trim(), href: '/sales/recurring-invoices' };
      }
      // An invoice: in rupees, priced on the server; in a foreign currency, an export under LUT.
      if (foreign) {
        const i = await api.post<{ _id: string }>('/currency/invoices', {
          customerId: f.customerId, currency: f.currency, rate: rateNumber, invoiceNumber: typedNumber, invoiceDate: f.date, dueDate: f.dueDate || undefined,
          lines: filled.map((l) => ({
            description: l.description.trim(),
            ...(l.itemId ? { itemId: l.itemId } : {}),
            ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
            ...(l.uqc ? { uqc: l.uqc } : {}),
            qty: Number(l.qty),
            rateMinor: toMinor(l.rate || '0', digits) ?? 0,
          })),
          shippingBill: f.shipping.number.trim() ? { number: f.shipping.number.trim(), date: f.shipping.date, portCode: f.shipping.portCode.trim().toUpperCase() } : null,
          notes: f.notes.trim() || undefined,
        });
        return { id: i._id, label: typedNumber ? `Invoice ${typedNumber}` : `Draft invoice to ${customer?.name ?? 'the customer'}`, href: `/sales/invoices/${i._id}` };
      }
      const i = await api.post<{ _id: string }>('/sales/invoices/from-lines', {
        customerId: f.customerId, invoiceNumber: typedNumber, invoiceDate: f.date, dueDate: f.dueDate || undefined, ...(termsDays(f.terms) !== null ? { paymentTermsDays: termsDays(f.terms) } : {}),
        ...(f.reference.trim() ? { referenceNumber: f.reference.trim() } : {}), ...(f.projectId ? { projectId: f.projectId } : {}), ...words(), ...priced(), lines: apiLines,
      });
      return { id: i._id, label: typedNumber ? `Invoice ${typedNumber}` : `Draft invoice to ${customer?.name ?? 'the customer'}`, href: `/sales/invoices/${i._id}` };
    },
    onSuccess: async (saved) => {
      rememberSalesperson(f.salesperson);
      for (const key of ['orders', 'sales', 'recurring', 'currency', 'payments', 'journals', 'gst']) void queryClient.invalidateQueries({ queryKey: [key] });
      if (k.attach && files.length) {
        const failed = await uploadFiles(k.attach, saved.id, files);
        if (failed.length) notify(`${saved.label} is saved, but ${failed.join(', ')} could not be attached. Attach from its page.`, 'error');
      }
      notify(kind === 'credit_note' ? `${saved.label} posted` : kind === 'recurring' ? `${saved.label} scheduled` : k.saved);
      return entry.finish(k.entity ? { entityType: k.entity, entityId: saved.id, label: saved.label } : null, saved.href);
    },
  });

  const submit = () => {
    const fail = (p: string) => setProblem(p);
    if (kind === 'recurring' && !f.profileName.trim()) return fail('Give the profile a name, like "Monthly retainer".');
    if (!f.customerId) return fail('Choose the customer.');
    if (!f.date) return fail(`Enter the ${k.dateLabel.toLowerCase()}.`);
    if (f.ownNumber && !f.number.trim()) return fail(`Type the ${k.numberLabel.replace('#', ' number').toLowerCase()}, or let it be numbered automatically.`);
    if (kind === 'quote' && f.validUntil && f.validUntil < f.date) return fail('The expiry date is on or after the quote date.');
    if (kind === 'order' && f.expectedBy && f.expectedBy < f.date) return fail('The expected shipment date is on or after the order date.');
    if (kind === 'invoice' && f.dueDate && f.dueDate < f.date) return fail('The due date cannot be before the invoice date.');
    if (kind === 'recurring' && !f.neverExpires && f.endDate && f.endDate < f.date) return fail('It ends before it starts.');
    if (kind === 'recurring' && termsDays(f.terms) === null) return fail('Choose the payment terms: each invoice is due that many days after its date.');
    if (kind === 'challan' && !f.reason) return fail('Choose the challan type: why the goods move.');
    if (kind === 'credit_note') {
      if (!f.invoiceId) return fail('Choose the invoice this credit note is against.');
      if (inv && f.date < inv.invoiceDate) return fail('A credit note cannot be dated before its invoice.');
      if (f.noteReason.trim().length < 3) return fail('Say why the note is raised, like "Two cartons returned".');
    }
    const lineProblem = checkLines(lines, money);
    if (lineProblem) return fail(lineProblem);
    if (pricing.discountProblem) return fail(`Discount: ${pricing.discountProblem}`);
    if (pricing.adjustmentProblem) return fail(`Adjustment: ${pricing.adjustmentProblem}`);
    if (kind === 'credit_note' && inv && pricing.amounts.taxableValue > inv.amountsPaise.taxableValue) return fail(`More than the ${formatPaise(inv.amountsPaise.taxableValue)} of taxable value the invoice was for.`);
    if (foreign) {
      if (!(rateNumber > 0) || Math.abs(Math.round(rateNumber * 10_000) - rateNumber * 10_000) > 1e-6) return fail(`Enter the rupees for one ${f.currency}, to four decimals at most.`);
      if (f.shipping.number.trim() && (!f.shipping.date || f.shipping.portCode.trim().length !== 6)) return fail('A shipping bill needs its date and the six-character port code.');
    }
    setProblem(null);
    save.mutate();
  };

  const autoNumber = !k.prefix ? '' : kind === 'invoice' ? `${k.prefix}/${fyOf(f.date || today)}/… when posted` : `${k.prefix}/${fyOf(f.date || today)}/next`;
  const dayOfMonth = Number((f.date || today).slice(8, 10));
  const supplyNote =
    f.customerId && supply.data && !foreign && kind !== 'credit_note'
      ? !supply.data.customerStateCode
        ? <span className="text-pending-fg">{customer?.name ?? 'This customer'} has no state: taxed as a sale within yours. <Link className="underline" href={`/sales/customers/${f.customerId}/edit`}>Set their state</Link>.</span>
        : interState
          ? `${stateName(supply.data.ourStateCode)} to ${stateName(supply.data.customerStateCode)}: IGST.`
          : `Within ${stateName(supply.data.customerStateCode)}: CGST and SGST.`
      : inv
        ? `Taxed as invoice ${inv.invoiceNumber ?? ''} was: ${interState ? 'IGST' : 'CGST and SGST'}.`
        : null;
  const hasProjects = (projects.data ?? []).length > 0;

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save it. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? k.saving : k.save}</Button>
          {k.entity && <EntryActions busy={save.isPending} />}
          <Button asChild variant="secondary"><Link href={kind === 'credit_note' && f.invoiceId && params.get('invoiceId') ? `/sales/invoices/${f.invoiceId}` : k.list}>Cancel</Link></Button>
          <p className="text-caption text-ink-500">{k.foot}</p>
        </>
      }
    >
      {/* The customer band */}
      <Section className="bg-surface-sink/60">
        {k.entity && <PartyFound kind="customer" chosen={!!f.customerId} selectId="doc-customer" />}
        <div className="grid gap-4 md:grid-cols-3">
          {kind === 'recurring' && (
            <Field label="Profile name" required className="md:col-span-3 lg:col-span-1" hint="What you call it: the invoices it drafts are listed under it.">
              <input className={inputClass} maxLength={120} value={f.profileName} onChange={(e) => set({ profileName: e.target.value })} placeholder="e.g. Monthly retainer" />
            </Field>
          )}
          <Field label="Customer name" required className="md:col-span-2">
            <div onClickCapture={(e) => (e.target as HTMLElement).closest('a[href^="/sales/customers/new"]') && keepDraft()}>
              <CustomerPicker id="doc-customer" value={f.customerId} onChange={pickCustomer} newHref={newCustomerHref} invalid={problem === 'Choose the customer.'} />
            </div>
          </Field>
          {kind === 'credit_note' && (
            <Field
              label="Against invoice"
              required
              className="md:col-span-1"
              hint={
                !f.customerId
                  ? 'Choose the customer first.'
                  : invoiceOptions.length === 0 && !customerInvoices.isLoading
                    ? 'This customer has no posted invoice. A GST credit note names the invoice it corrects.'
                    : 'GST asks the note to name the invoice it corrects; GSTR-1 files it beside it.'
              }
            >
              <SearchSelect
                value={f.invoiceId}
                onChange={(invoiceId) => set({ invoiceId })}
                options={invoiceOptions}
                disabled={!f.customerId}
                placeholder={customerInvoices.isLoading ? 'Loading invoices…' : 'Choose a posted invoice'}
                searchPlaceholder="Search invoice numbers"
                aria-label="Invoice"
              />
            </Field>
          )}
        </div>
        {inv && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-200 bg-white px-4 py-3">
            <dl className="flex flex-wrap gap-x-8 gap-y-1 text-body">
              <div><dt className="text-caption text-ink-500">Invoice date</dt><dd>{shortDate(inv.invoiceDate)}</dd></div>
              <div><dt className="text-caption text-ink-500">Taxable value</dt><dd className="font-mono tabular-nums">{formatPaise(inv.amountsPaise.taxableValue)}</dd></div>
              <div><dt className="text-caption text-ink-500">Total</dt><dd className="font-mono tabular-nums">{formatPaise(inv.amountsPaise.total)}</dd></div>
              <div><dt className="text-caption text-ink-500">Still owed</dt><dd className="font-mono tabular-nums">{formatPaise(owed)}</dd></div>
            </dl>
            {inv.lineItems.length > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={copyInvoiceLines}><Copy size={13} /> Copy the invoice&apos;s lines</Button>
            )}
          </div>
        )}
      </Section>

      {/* The document's details */}
      <Section title={kind === 'recurring' ? 'Schedule and details' : `${k.label} details`}>
        <div className="grid gap-4 md:grid-cols-3">
          {k.prefix && kind !== 'credit_note' && (
            <NumberField
              label={k.numberLabel}
              value={f.number}
              onChange={(number) => set({ number })}
              own={f.ownNumber}
              onOwn={(ownNumber) => set({ ownNumber })}
              autoText={autoNumber}
              hint={kind === 'invoice' ? 'The next number, given when it is posted. The cog types your own.' : 'The next in the series when you save. The cog types your own.'}
            />
          )}
          {kind === 'credit_note' && (
            <Field label={k.numberLabel} hint="The next credit note number, when it posts.">
              <input className={`${inputClass} font-mono text-ink-500`} value={autoNumber} readOnly tabIndex={-1} />
            </Field>
          )}
          {kind !== 'recurring' && (
            <Field label={kind === 'invoice' ? 'Order number' : kind === 'order' ? "Reference# (customer's PO)" : 'Reference#'}>
              <input className={`${inputClass} font-mono`} maxLength={60} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
            </Field>
          )}
          {kind === 'recurring' && (
            <Field label="Order number">
              <input className={`${inputClass} font-mono`} maxLength={60} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
            </Field>
          )}
          {kind === 'recurring' && (
            <Field label="Repeat every" required>
              <select className={inputClass} value={f.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
                {(Object.keys(FREQUENCY_WORDS) as Frequency[]).map((fq) => <option key={fq} value={fq}>{FREQUENCY_WORDS[fq]}</option>)}
              </select>
            </Field>
          )}
          <Field
            label={k.dateLabel}
            required
            hint={
              kind === 'recurring' && f.date
                ? f.frequency === 'weekly' || f.frequency === 'fortnightly'
                  ? `Every ${f.frequency === 'weekly' ? '' : 'other '}${WEEKDAY(f.date)} from ${shortDate(f.date)}.`
                  : `On the ${dayOfMonth >= 29 ? `${ordinal(dayOfMonth)} (the month's last day when shorter)` : ordinal(dayOfMonth)}, from ${shortDate(f.date)}.`
                : undefined
            }
          >
            <input type="date" className={inputClass} value={f.date} min={inv?.invoiceDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === 'quote' && (
            <Field label="Expiry date" hint="Blank: 15 days from the quote date.">
              <input type="date" className={inputClass} value={f.validUntil} min={f.date} onChange={(e) => set({ validUntil: e.target.value })} />
            </Field>
          )}
          {kind === 'order' && (
            <Field label="Expected shipment date">
              <input type="date" className={inputClass} value={f.expectedBy} min={f.date} onChange={(e) => set({ expectedBy: e.target.value })} />
            </Field>
          )}
          {kind === 'recurring' && (
            <Field label="Ends on">
              <div className="space-y-1.5">
                <input type="date" className={inputClass} value={f.neverExpires ? '' : f.endDate} min={f.date} disabled={f.neverExpires} onChange={(e) => set({ endDate: e.target.value })} />
                <label className="flex items-center gap-2 text-caption text-ink-700">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.neverExpires} onChange={(e) => set({ neverExpires: e.target.checked })} />
                  Never expires
                </label>
              </div>
            </Field>
          )}
          {(kind === 'invoice' || kind === 'order' || kind === 'recurring') && (
            <PaymentTermsField
              value={f.terms}
              onChange={setTerms}
              allowNone={kind !== 'recurring'}
              monthEnd={kind === 'invoice'}
              label={kind === 'invoice' ? 'Terms' : 'Payment terms'}
              hint={agreedTerms && agreedTerms === f.terms ? `${customer?.name ?? 'The customer'}'s agreed terms.` : agreedTerms ? `${customer?.name ?? 'The customer'} usually has ${termsLabel(agreedTerms) ?? agreedTerms}.` : undefined}
            />
          )}
          {kind === 'invoice' && (
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
          {kind === 'order' && (
            <Field label="Delivery method">
              <input className={inputClass} list="aibooks-delivery-methods" maxLength={60} value={f.deliveryMethod} onChange={(e) => set({ deliveryMethod: e.target.value })} placeholder="Select or type" />
              <datalist id="aibooks-delivery-methods">{DELIVERY_METHODS.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          )}
          {kind === 'challan' && (
            <Field label="Challan type" required hint="Why the goods move without an invoice (rule 55).">
              <select className={inputClass} value={f.reason} onChange={(e) => set({ reason: e.target.value })}>
                <option value="">Choose a type…</option>
                {CHALLAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          )}
          {kind === 'challan' && (
            <Field label="Vehicle number">
              <input className={`${inputClass} font-mono uppercase`} maxLength={20} value={f.vehicleNo} onChange={(e) => set({ vehicleNo: e.target.value })} placeholder="MH12AB1234" />
            </Field>
          )}
          {kind === 'credit_note' && (
            <Field label="Reason" required className="md:col-span-2">
              <input className={inputClass} maxLength={300} value={f.noteReason} onChange={(e) => set({ noteReason: e.target.value })} placeholder="e.g. Two cartons returned" />
            </Field>
          )}
          {kind !== 'challan' && <SalespersonField value={f.salesperson} onChange={(salesperson) => set({ salesperson })} />}
          {(kind === 'quote' || kind === 'invoice') && hasProjects && (
            <Field label="Project" hint={kind === 'invoice' ? 'Each line’s income is booked to it.' : undefined}>
              <select className={inputClass} value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                <option value="">No project</option>
                {(projects.data ?? []).filter((p) => p.status !== 'completed' || p.id === f.projectId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.customerName ? ` · ${p.customerName}` : ''}</option>
                ))}
              </select>
            </Field>
          )}
          {kind === 'invoice' && (
            <Field label="Currency" hint={foreign ? 'An export: zero-rated under your LUT, no GST.' : undefined}>
              <select className={inputClass} value={f.currency} onChange={(e) => set({ currency: e.target.value, rate: '' })}>
                <option value="INR">INR · Indian rupee</option>
                {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
          )}
          {foreign && (
            <Field label={`Rate (₹ for 1 ${f.currency})`} required hint={storedRate.data ? `From the stored rate of ${storedRate.data.date}.` : 'No stored rate on or before this date: enter the day’s rate.'}>
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} placeholder="84.1025" />
            </Field>
          )}
          {kind !== 'challan' && (
            <Field label="Subject" className="md:col-span-3" hint={`Let your customer know what this ${kind === 'recurring' ? 'invoice' : k.label.toLowerCase()} is for.`}>
              <input className={inputClass} maxLength={250} value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
          )}
        </div>
      </Section>

      <Section
        title="Item table"
        description={
          foreign
            ? `Prices in ${f.currency}. Each line is converted to rupees once, at the rate above.`
            : kind === 'credit_note'
              ? 'What is credited: each line comes back off its income account, Sales unless you choose another.'
              : 'Pick an item to fill the line, or type it. This customer’s last price fills the rate.'
        }
      >
        <SaleLinesTable lines={lines} onChange={setLines} customerId={f.customerId} money={money} showAccount={kind === 'credit_note'} noTax={foreign} shares={shares} />
      </Section>

      {foreign && (
        <Section title="Shipping bill" description="For exported goods. Services have none; leave it blank.">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Shipping bill number">
              <input className={`${inputClass} font-mono`} value={f.shipping.number} onChange={(e) => set({ shipping: { ...f.shipping, number: e.target.value } })} />
            </Field>
            <Field label="Shipping bill date">
              <input type="date" className={inputClass} value={f.shipping.date} onChange={(e) => set({ shipping: { ...f.shipping, date: e.target.value } })} />
            </Field>
            <Field label="Port code">
              <input className={`${inputClass} font-mono uppercase`} maxLength={6} placeholder="INNSA1" value={f.shipping.portCode} onChange={(e) => set({ shipping: { ...f.shipping, portCode: e.target.value } })} />
            </Field>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_28rem]">
        <Section>
          <div className="space-y-4">
            <Field label="Customer notes" hint={k.notesHint}>
              <textarea className={inputClass} rows={3} maxLength={foreign ? 1000 : 2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Bank details, a thank-you" />
            </Field>
            {!foreign && (
              <Field label="Terms & conditions" hint="Printed under the notes.">
                <textarea className={inputClass} rows={3} maxLength={3000} value={f.termsText} onChange={(e) => set({ termsText: e.target.value })} placeholder="Enter the terms and conditions of your business to be displayed on the document" />
              </Field>
            )}
            {k.attach && (
              <Field label="Attach files">
                <AttachFiles files={files} onChange={setFiles} />
              </Field>
            )}
          </div>
        </Section>
        <Section title="Totals" className="lg:sticky lg:top-20">
          <TotalsPanel
            pricing={pricing}
            interState={interState}
            discount={kind === 'challan' || foreign ? undefined : { mode: f.discountMode, value: f.discount, onMode: (discountMode) => set({ discountMode }), onValue: (discount) => set({ discount }) }}
            adjustment={
              kind === 'challan' || kind === 'credit_note' || foreign
                ? undefined
                : { label: f.adjustmentLabel, value: f.adjustment, onLabel: (adjustmentLabel) => set({ adjustmentLabel }), onValue: (adjustment) => set({ adjustment }) }
            }
            foreignTotal={
              foreign ? (
                <>
                  <div className="flex justify-between py-1.5"><dt className="text-body text-ink-600">Total in {f.currency}</dt><dd className="font-mono tabular-nums">{formatMinor(foreignTotal, f.currency, digits)}</dd></div>
                  <div className="flex justify-between py-1.5"><dt className="text-body text-ink-600">GST</dt><dd className="font-mono">Nil (LUT)</dd></div>
                  <div className="mt-1 flex justify-between border-t border-line-200 pt-3 font-semibold">
                    <dt className="text-body">In rupees</dt>
                    <dd className="font-mono tabular-nums">{rateNumber > 0 ? `≈ ${formatPaise(Math.round((foreignTotal / 10 ** digits) * rateNumber * 100))}` : '—'}</dd>
                  </div>
                </>
              ) : undefined
            }
            noTax={foreign}
            supplyNote={supplyNote}
          />
          {kind === 'credit_note' && inv && pricing.amounts.total > owed && (
            <p className="mt-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
              {formatPaise(pricing.amounts.total - owed)} more than the invoice still owes: that part becomes the customer&apos;s credit, to apply to their next invoice or refund.
            </p>
          )}
          {kind === 'recurring' && pricing.amounts.total > 0 && (
            <p className="mt-3 text-caption text-ink-500">Each invoice drafted comes to <span className="font-mono tabular-nums text-ink-900">{formatPaise(pricing.amounts.total)}</span>.</p>
          )}
        </Section>
      </div>
    </FormPage>
  );
}

/** The form for a quote, sales order or challan, as the pages have always called it. */
export function SalesDocForm({ kind }: { kind: 'quote' | 'order' | 'challan' }) {
  return <SalesDocumentForm kind={kind} />;
}
