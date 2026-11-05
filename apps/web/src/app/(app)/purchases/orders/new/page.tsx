'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import { AmountsSummary, BillLineEditor, billLinesToApi, emptyBillLine, previewAmounts, type BillEditLine } from '@/components/purchases/bill-lines';
import { errorText, todayIso, useVendors } from '@/components/purchases/purchase-data';

/** A purchase order to a vendor. It posts nothing: goods are received against it, and the bill matched to it. */
export default function NewPurchaseOrderPage({ searchParams }: { searchParams: { vendorId?: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const vendors = useVendors();
  const workspace = useWorkspace();
  const [vendorId, setVendorId] = useState(searchParams.vendorId ?? '');
  const [date, setDate] = useState(todayIso());
  const [expectedBy, setExpectedBy] = useState('');
  const [lines, setLines] = useState<BillEditLine[]>([emptyBillLine()]);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const vendor = (vendors.data ?? []).find((v) => v._id === vendorId);
  const ours = workspace.data?.org.gstin?.slice(0, 2) ?? null;
  const theirs = vendor?.gstin?.slice(0, 2) ?? null;
  const preview = previewAmounts(lines, !!ours && !!theirs && ours !== theirs);

  const raise = useMutation({
    mutationFn: () => {
      if (!vendorId) throw new Error('Choose the vendor.');
      if (expectedBy && expectedBy < date) throw new Error('Needed by is before the order date.');
      const parsed = billLinesToApi(lines);
      if (!parsed.ok) throw new Error(parsed.problem);
      return api.post<{ _id: string; number: string }>('/orders/purchase-orders', {
        vendorId,
        date,
        expectedBy: expectedBy || null,
        // A PO line has no project: the bill it becomes carries the cost.
        lines: parsed.lines.map((l) => ({ description: l.description, itemId: l.itemId, hsnSac: l.hsnSac, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct })),
        notes: notes.trim() || null,
      });
    },
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      notify(`Purchase order ${po.number} raised`);
      router.push(`/purchases/orders/${po._id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't raise the purchase order.")),
  });

  return (
    <div>
      <PageHeader title="New purchase order" subtitle="Numbered when saved. Send it to the vendor from its page." back={{ href: '/purchases/orders', label: 'Purchase orders' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          raise.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={raise.isPending}>{raise.isPending ? 'Saving…' : 'Raise purchase order'}</Button>
            <Button type="button" variant="secondary" asChild>
              <Link href="/purchases/orders">Cancel</Link>
            </Button>
          </>
        }
      >
        <Section title="Order">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Vendor" required className="md:col-span-3">
              <select className={inputClass} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{vendors.isLoading ? 'Loading…' : 'Choose a vendor…'}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v._id} value={v._id}>{v.name}{v.gstin ? ` · ${v.gstin}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Order date" required>
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Needed by">
              <input type="date" className={inputClass} value={expectedBy} min={date} onChange={(e) => setExpectedBy(e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title="Lines">
          <BillLineEditor lines={lines} onChange={setLines} showProject={false} />
          <div className="mt-4 border-t border-line-100 pt-4">
            <AmountsSummary amounts={preview} note="The server works out the tax when it saves." />
          </div>
        </Section>
        <Section title="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, terms" maxLength={1000} />
        </Section>
      </FormPage>
    </div>
  );
}
