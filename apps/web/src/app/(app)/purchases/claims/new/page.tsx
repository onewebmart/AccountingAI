'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { ClaimLinesEditor, blankClaimLine, claimLinesToApi, type ClaimEditLine } from '@/components/purchases/claim-lines';
import { errorText, useExpenseAccounts } from '@/components/purchases/purchase-data';

/** A new claim, saved as a draft: attach the receipts on its page, then submit it for approval. */
export default function NewClaimPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const accounts = useExpenseAccounts();
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<ClaimEditLine[]>([blankClaimLine()]);
  const [problem, setProblem] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Give the claim a title, like "Client visit, Pune".');
      const body = claimLinesToApi(lines);
      if (body.length === 0) throw new Error('Add at least one line.');
      return api.post<{ _id: string; number: string }>('/expense-claims', { title: title.trim(), lines: body });
    },
    onSuccess: (claim) => {
      void qc.invalidateQueries({ queryKey: ['expense-claims'] });
      notify(`Claim ${claim.number} saved as a draft: attach receipts, then submit`);
      router.push(`/purchases/claims/${claim._id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the claim.")),
  });

  return (
    <div>
      <PageHeader title="New claim" subtitle="What you paid for the business. Someone else approves it before it is posted." back={{ href: '/purchases/claims', label: 'Employee claims' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          create.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save claim'}</Button>
            <Button type="button" variant="secondary" asChild><Link href="/purchases/claims">Cancel</Link></Button>
          </>
        }
      >
        <Section title="Claim">
          <Field label="Title" required className="max-w-md">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client visit, Pune" maxLength={120} />
          </Field>
        </Section>
        <Section title="Lines" description="Mileage is paid at the rate your organisation sets; GST is claimed only with the merchant's GSTIN.">
          <ClaimLinesEditor lines={lines} onChange={setLines} accounts={accounts.data} claimId={null} />
        </Section>
      </FormPage>
    </div>
  );
}
