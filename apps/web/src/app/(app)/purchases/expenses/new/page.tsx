'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormPage, PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { ExpenseFields, emptyExpense, expenseBody, useInterState, type ExpenseFormValue, NOTES_MAX } from '@/components/purchases/expense-form';
import { MILEAGE_SETTINGS_HREF, MileageFields, emptyMileage, mileageBody, useMileageSettings, type MileageFormValue } from '@/components/purchases/mileage';
import { BulkGrid, firstRows, isFilled, rowBody, rowProblem, type BulkRow } from '@/components/purchases/bulk-expenses';
import { ExpenseTabs, useCanManageSettings, type ExpenseTab } from '@/components/purchases/expense-tabs';
import { errorText } from '@/components/purchases/purchase-data';
import { DocumentEntry, EntryActions, PartyFound, gstSlab, rupeesOf, scanTaxRate, scanTaxable, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

/**
 * A new expense, three ways, as tabs: one expense (optionally itemized across
 * accounts), a mileage trip, or many at once in a grid. Opened from a scanned
 * receipt or bill (?document=), Record Expense shows the file beside the form,
 * which starts filled from it.
 */
export default function NewExpensePage({ searchParams }: { searchParams: { document?: string; tab?: string; prefs?: string } }) {
  const tab: ExpenseTab = searchParams.tab === 'mileage' ? 'mileage' : searchParams.tab === 'bulk' ? 'bulk' : 'expense';
  if (tab === 'mileage') return <RecordMileage skipPreferences={searchParams.prefs === 'skip'} />;
  if (tab === 'bulk') return <BulkAddExpenses />;
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <NewExpenseForm documentId={searchParams.document ?? null} />
    </DocumentEntry>
  );
}

function Header({ tab, documentId, subtitle }: { tab: ExpenseTab; documentId?: string | null; subtitle: string }) {
  return (
    <>
      <PageHeader guide="expenses" title="New expense" subtitle={subtitle} back={{ href: '/purchases/expenses', label: 'Expenses' }} />
      <ExpenseTabs active={tab} documentId={documentId} />
    </>
  );
}

/** Save, then post at once when asked. A payment approval policy may hold the posting: the draft is saved either way. */
function useSaveExpense(entityLabel = 'Expense') {
  const qc = useQueryClient();
  const entry = useDocumentEntry();
  return useMutation({
    mutationFn: async ({ body, andPost }: { body: Record<string, unknown>; andPost: boolean }) => {
      const created = await api.post<{ _id: string; number: string }>('/direct-expenses', body);
      if (!andPost) return { created, posted: false as const, held: null, failed: null };
      try {
        await api.post(`/direct-expenses/${created._id}/post`);
        return { created, posted: true as const, held: null, failed: null };
      } catch (e) {
        // Saved, not posted: approval needed, or the ledger refused it. Either way the draft is there to open.
        const held = e instanceof ApiError && e.status === 409;
        return { created, posted: false as const, held: held ? errorText(e) : null, failed: held ? null : errorText(e) };
      }
    },
    onSuccess: ({ created, posted, held, failed }) => {
      void qc.invalidateQueries({ queryKey: ['direct-expenses'] });
      if (posted) {
        void qc.invalidateQueries({ queryKey: ['journals'] });
        notify(`${entityLabel} ${created.number} posted to ledger`);
      } else if (held) notify(`${entityLabel} ${created.number} saved. ${held}`, 'info');
      else if (failed) notify(`${entityLabel} ${created.number} saved as a draft, not posted: ${failed}`, 'error');
      else notify(`${entityLabel} ${created.number} saved`);
      return entry.finish({ entityType: 'DirectExpense', entityId: created._id, label: `Expense ${created.number}` }, `/purchases/expenses/${created._id}`);
    },
  });
}

function SaveButtons({ pending, posting, onPost }: { pending: boolean; posting: boolean; onPost: () => void }) {
  return (
    <>
      <Button type="submit" disabled={pending}>{pending && !posting ? 'Saving…' : 'Save expense'}</Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={onPost}>{pending && posting ? 'Posting…' : 'Save and post'}</Button>
    </>
  );
}

// ── Record Expense ───────────────────────────────────────────────────────────

function NewExpenseForm({ documentId }: { documentId: string | null }) {
  const [value, setValue] = useState<ExpenseFormValue>(emptyExpense);
  const [problem, setProblem] = useState<string | null>(null);
  const interState = useInterState(value);
  const save = useSaveExpense();

  // From a scan: the amount before tax, its one GST rate, who was paid and the receipt number.
  usePrefill((x) => {
    const taxable = scanTaxable(x);
    const rates = [...new Set(x.lines.filter((l) => l.taxRatePct > 0).map((l) => gstSlab(l.taxRatePct)))];
    const rate = rates.length === 1 ? rates[0] : scanTaxRate(x);
    const a = x.amountsPaise;
    setValue((v) => ({
      ...v,
      date: x.date ?? v.date,
      vendorId: v.vendorId || x.vendor?.id || '',
      amount: taxable > 0 ? rupeesOf(taxable) : v.amount,
      gstRatePct: rate,
      // The tax heads charged say where the supplier is: IGST from another state.
      interState: a && a.igst > 0 ? true : a && a.cgst + a.sgst > 0 ? false : null,
      // Input credit needs the supplier's GSTIN on the invoice.
      claimable: rate > 0 && !!x.party.gstin,
      vendorGstin: x.party.gstin ?? '',
      reference: x.number ? x.number.slice(0, 120) : v.reference,
      notes: v.notes || (x.lines[0]?.description ?? '').trim().slice(0, NOTES_MAX),
    }));
  });

  const submit = (andPost: boolean) => {
    setProblem(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('Enter the date it was paid.');
      save.mutate({ body: { ...expenseBody(value, interState), date: value.date, notes: value.notes.trim() || null }, andPost }, { onError: (e) => setProblem(errorText(e, "Couldn't save the expense.")) });
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  return (
    <div>
      <Header tab="expense" documentId={documentId} subtitle="Paid straight from bank or cash. Posting makes one payment voucher." />
      <FormPage
        onSubmit={() => submit(false)}
        error={problem}
        actions={
          <>
            <SaveButtons pending={save.isPending} posting={!!save.variables?.andPost} onPost={() => submit(true)} />
            <EntryActions busy={save.isPending} />
            <Button type="button" variant="ghost" asChild><Link href="/purchases/expenses">Cancel</Link></Button>
          </>
        }
      >
        <ExpenseFields
          value={value}
          onChange={(p) => setValue((v) => ({ ...v, ...p }))}
          notice={<PartyFound kind="vendor" chosen={!!value.vendorId} selectId="expense-vendor" />}
        />
      </FormPage>
    </div>
  );
}

// ── Record Mileage ───────────────────────────────────────────────────────────

/** A trip at the mileage rate. The first time, with no rate set, the preferences open first. */
function RecordMileage({ skipPreferences }: { skipPreferences: boolean }) {
  const router = useRouter();
  const canManage = useCanManageSettings();
  const settings = useMileageSettings();
  const [value, setValue] = useState<MileageFormValue>(emptyMileage);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveExpense('Mileage expense');

  useEffect(() => {
    if (settings.data && !settings.data.configured && canManage && !skipPreferences) router.replace(`${MILEAGE_SETTINGS_HREF}?first=1`);
  }, [settings.data, canManage, skipPreferences, router]);

  const submit = (andPost: boolean) => {
    setProblem(null);
    try {
      save.mutate({ body: mileageBody(value, settings.data), andPost }, { onError: (e) => setProblem(errorText(e, "Couldn't save the mileage expense.")) });
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  return (
    <div>
      <Header tab="mileage" subtitle="A trip at your mileage rate: distance × the rate in force on its date. Posting makes one payment voucher." />
      <FormPage
        onSubmit={() => submit(false)}
        error={problem}
        actions={
          <>
            <SaveButtons pending={save.isPending} posting={!!save.variables?.andPost} onPost={() => submit(true)} />
            <Button type="button" variant="ghost" asChild><Link href="/purchases/expenses">Cancel</Link></Button>
          </>
        }
      >
        {settings.isError ? (
          <p className="text-caption text-error-fg">Couldn&apos;t load the mileage preferences: {errorText(settings.error)}</p>
        ) : (
          <MileageFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} settings={settings.data} canManage={canManage} />
        )}
      </FormPage>
    </div>
  );
}

// ── Bulk Add Expenses ────────────────────────────────────────────────────────

interface BulkResult {
  created: Array<{ row: number; _id: string; number: string }>;
  posted: Array<{ row: number; _id: string; number: string }>;
  held: Array<{ row: number; _id: string; number: string; reason: string }>;
  failed: Array<{ row: number; _id: string; number: string; reason: string }>;
}

/** Bad rows, as the server names them: their row numbers among the rows sent. */
function serverRows(e: unknown): Array<{ row: number; error: string }> | null {
  if (!(e instanceof ApiError) || !e.body || typeof e.body !== 'object') return null;
  const rows = (e.body as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<{ row: number; error: string }>) : null;
}

/**
 * Many expenses at once. Save expenses keeps them as drafts; Save and post
 * posts each in its own voucher. Every row is checked first: if any is wrong,
 * nothing is saved and the rows say why.
 */
function BulkAddExpenses() {
  const router = useRouter();
  const qc = useQueryClient();
  const [rows, setRows] = useState<BulkRow[]>(firstRows);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const filled = rows.filter(isFilled);
      if (filled.length === 0) throw new Error('Fill in at least one row: the date, account, amount and paid through.');
      const local = new Map<number, string>();
      for (const r of filled) {
        const p = rowProblem(r);
        if (p) local.set(r.key, p);
      }
      setErrors(local);
      if (local.size) throw new Error(`${local.size === 1 ? '1 row needs' : `${local.size} rows need`} a fix. Nothing was saved.`);
      try {
        const result = await api.post<BulkResult>('/direct-expenses/bulk', { expenses: filled.map(rowBody), post: andPost });
        return { result, andPost };
      } catch (e) {
        const bad = serverRows(e);
        if (bad) setErrors(new Map(bad.filter((b) => filled[b.row - 1]).map((b) => [filled[b.row - 1].key, b.error])));
        throw e;
      }
    },
    onSuccess: ({ result, andPost }) => {
      void qc.invalidateQueries({ queryKey: ['direct-expenses'] });
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      if (!andPost) notify(`${n(result.created.length, 'expense', 'expenses')} saved`);
      else {
        void qc.invalidateQueries({ queryKey: ['journals'] });
        if (result.posted.length) notify(`${n(result.posted.length, 'expense', 'expenses')} posted to ledger`);
        if (result.held.length) notify(`${n(result.held.length, 'expense waits', 'expenses wait')} for approval: ${result.held.map((h) => h.number).join(', ')}.`, 'info');
        if (result.failed.length) notify(`${n(result.failed.length, 'expense was', 'expenses were')} saved as drafts, not posted: ${result.failed[0].reason}`, 'error');
      }
      router.push('/purchases/expenses');
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the expenses.")),
  });

  const run = (andPost: boolean) => {
    setProblem(null);
    save.mutate(andPost);
  };

  return (
    <div>
      <Header tab="bulk" subtitle="Several expenses at once, a row each. Blank rows are left out; if any row is wrong, nothing is saved." />
      <FormPage
        onSubmit={() => run(false)}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending && !save.variables ? 'Saving…' : 'Save expenses'}</Button>
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => run(true)}>{save.isPending && save.variables ? 'Posting…' : 'Save and post'}</Button>
            <Button type="button" variant="ghost" asChild><Link href="/purchases/expenses">Cancel</Link></Button>
          </>
        }
      >
        <BulkGrid rows={rows} onChange={setRows} errors={errors} />
        <p className="text-caption text-ink-500">
          The amount is what was paid, with no GST split. For GST to claim, a split across accounts, or mileage, use the other tabs.
        </p>
      </FormPage>
    </div>
  );
}
