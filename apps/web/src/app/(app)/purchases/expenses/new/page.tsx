'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormPage, PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { ExpenseFields, emptyExpense, expenseBody, useInterState, type ExpenseFormValue } from '@/components/purchases/expense-form';
import { errorText } from '@/components/purchases/purchase-data';
import { DocumentEntry, EntryActions, PartyFound, gstSlab, rupeesOf, scanTaxRate, scanTaxable, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

/** Opened from a scanned receipt or bill (?document=), the file shows beside the form, which starts filled from it. */
export default function NewExpensePage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <NewExpenseForm />
    </DocumentEntry>
  );
}

/**
 * A new expense. Save expense keeps it a draft; Save and post saves it and
 * posts the payment voucher at once (a payment approval policy may hold
 * the posting: the draft is saved either way).
 */
function NewExpenseForm() {
  const qc = useQueryClient();
  const entry = useDocumentEntry();
  const [value, setValue] = useState<ExpenseFormValue>(emptyExpense);
  const [problem, setProblem] = useState<string | null>(null);
  const interState = useInterState(value);

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
      notes: v.notes || (x.lines[0]?.description ?? '').trim().slice(0, 1000),
    }));
  });

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('Enter the date it was paid.');
      const created = await api.post<{ _id: string; number: string }>('/direct-expenses', { ...expenseBody(value, interState), date: value.date, notes: value.notes.trim() || null });
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
        notify(`Expense ${created.number} posted to ledger`);
      } else if (held) notify(`Expense ${created.number} saved. ${held}`, 'info');
      else if (failed) notify(`Expense ${created.number} saved as a draft, not posted: ${failed}`, 'error');
      else notify(`Expense ${created.number} saved`);
      return entry.finish({ entityType: 'DirectExpense', entityId: created._id, label: `Expense ${created.number}` }, `/purchases/expenses/${created._id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the expense.")),
  });

  return (
    <div>
      <PageHeader title="New expense" subtitle="Paid straight from bank or cash. Posting makes one payment voucher." back={{ href: '/purchases/expenses', label: 'Expenses' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          save.mutate(false);
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending && !save.variables ? 'Saving…' : 'Save expense'}</Button>
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => { setProblem(null); save.mutate(true); }}>
              {save.isPending && save.variables ? 'Posting…' : 'Save and post'}
            </Button>
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
