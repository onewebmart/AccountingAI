'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AccountSelect, Notice, errorText, isApprovalHold, todayIso } from '@/components/accountant/common';
import type { JournalItem } from '@/components/accountant/journal-types';
import { ProjectSelect } from '@/components/projects/project-select';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { DocumentEntry, EntryActions, scanSummary, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

interface Line { accountId: string; description: string; debit: string; credit: string; projectId: string }
const blank = (): Line => ({ accountId: '', description: '', debit: '', credit: '', projectId: '' });
const cell = 'rounded-md border border-line-200 bg-white px-2 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40 disabled:bg-surface-sink';

/** Paise from a typed amount: 0 when blank, null when it is not an amount or is negative. */
const amount = (v: string) => {
  const p = parseRupees(v);
  return p === null || p < 0 ? null : p;
};

/** Opened from a scan (?document=), the file shows beside the journal: its date and narration come from it, the accounts from the person. */
export default function NewManualJournalPage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <NewManualJournal />
    </DocumentEntry>
  );
}

function NewManualJournal() {
  const qc = useQueryClient();
  const entry = useDocumentEntry();
  const [date, setDate] = useState(todayIso());
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  // From a scan: the date, and a narration naming the document. Which accounts move is the person's call.
  usePrefill((x) => {
    if (x.date) setDate(x.date);
    setNarration((n) => n || scanSummary(x).slice(0, 300));
  });

  const set = (i: number, patch: Partial<Line>) => setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const used = lines.filter((l) => l.accountId || l.debit.trim() || l.credit.trim() || l.description.trim());
  const debit = used.reduce((s, l) => s + (amount(l.debit) ?? 0), 0);
  const credit = used.reduce((s, l) => s + (amount(l.credit) ?? 0), 0);
  const difference = debit - credit;

  const post = useMutation({
    mutationFn: () => {
      const body = used.map((l, n) => {
        const d = amount(l.debit);
        const c = amount(l.credit);
        if (!l.accountId) throw new Error(`Line ${n + 1}: choose an account.`);
        if (d === null || c === null) throw new Error(`Line ${n + 1}: enter amounts in rupees, like 25,000.50.`);
        if ((d > 0) === (c > 0)) throw new Error(`Line ${n + 1}: enter a debit or a credit, not both and not neither.`);
        return { accountId: l.accountId, description: l.description.trim() || undefined, debitPaise: d, creditPaise: c, projectId: l.projectId || null };
      });
      if (body.length < 2) throw new Error('A journal needs at least two lines.');
      if (debit !== credit) throw new Error(`Debits and credits differ by ${formatPaise(Math.abs(difference))}.`);
      if (debit === 0) throw new Error('A journal must move some amount.');
      return api.post<JournalItem>('/journals', { voucherType: 'JOURNAL', date, narration: narration.trim() || undefined, lines: body });
    },
    onMutate: () => setError(null),
    onSuccess: (j) => {
      void qc.invalidateQueries({ queryKey: ['journals'] });
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify('Journal posted');
      return entry.finish({ entityType: 'Journal', entityId: j._id, label: `Journal ${j.voucherNumber}` }, `/accountant/manual-journals/${j._id}`);
    },
    onError: (err) => {
      if (isApprovalHold(err)) {
        setHeld(err.message);
        notify('Sent for approval', 'info');
        return;
      }
      setError(errorText(err, "Couldn't post the journal."));
    },
  });

  if (held) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sent for approval" back={{ href: '/accountant/manual-journals', label: 'Manual journals' }} />
        <Notice tone="pending">{held}</Notice>
        <p className="text-body text-ink-600">The journal posts, exactly as entered, once it is approved. Nothing is in the ledger until then.</p>
        {entry.active && (
          <p className="text-body text-ink-600">The scan stays in Documents, not yet entered: attach it to the journal from its page once it is approved.</p>
        )}
        <div className="flex gap-2">
          <Button asChild><Link href="/approvals">Open approvals</Link></Button>
          <Button variant="secondary" onClick={() => { setHeld(null); setLines([blank(), blank()]); setNarration(''); }}>New journal</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="New journal"
        subtitle="Debits must equal credits. It posts to the ledger when you press Post journal, unless an approval policy holds it."
        back={{ href: '/accountant/manual-journals', label: 'Manual journals' }}
      />
      <FormPage
        onSubmit={() => post.mutate()}
        error={error}
        actions={
          <>
            <Button type="submit" disabled={post.isPending || debit === 0 || difference !== 0}>{post.isPending ? 'Posting…' : 'Post journal'}</Button>
            {/* Like Post journal, it waits for a balanced entry; Skip for now does not. */}
            <EntryActions busy={post.isPending} nextLabel="Post and next" nextDisabled={debit === 0 || difference !== 0} />
            <Button type="button" variant="secondary" asChild><Link href="/accountant/manual-journals">Cancel</Link></Button>
            <span className="ml-auto font-mono text-body tabular-nums text-ink-700">
              Dr {formatPaise(debit)} · Cr {formatPaise(credit)}
            </span>
          </>
        }
      >
        <Section title="Voucher">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Date" required>
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Narration" className="md:col-span-3" hint="Why this entry is made: it is printed on the voucher and kept in the audit trail.">
              <input className={inputClass} value={narration} maxLength={300} onChange={(e) => setNarration(e.target.value)} placeholder="Provision for audit fees, FY 2026-27" />
            </Field>
          </div>
        </Section>

        <Section title="Lines" description="One account per line, with a debit or a credit.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="text-left text-caption text-ink-500">
                  <th className="pb-2 pr-2 font-medium">Account</th>
                  <th className="pb-2 pr-2 font-medium">Description</th>
                  <th className="pb-2 pr-2 text-right font-medium">Debit (₹)</th>
                  <th className="pb-2 pr-2 text-right font-medium">Credit (₹)</th>
                  <th className="pb-2 pr-2 font-medium">Project</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const bad = amount(l.debit) === null || amount(l.credit) === null;
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-2"><AccountSelect className={`${cell} w-64`} value={l.accountId} onChange={(v) => set(i, { accountId: v })} /></td>
                      <td className="py-1 pr-2"><input className={`${cell} w-full`} value={l.description} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} /></td>
                      <td className="py-1 pr-2">
                        <input className={`${cell} w-32 text-right font-mono`} inputMode="decimal" value={l.debit} disabled={!!l.credit.trim()} onChange={(e) => set(i, { debit: e.target.value })} aria-label={`Line ${i + 1} debit`} />
                      </td>
                      <td className="py-1 pr-2">
                        <input className={`${cell} w-32 text-right font-mono`} inputMode="decimal" value={l.credit} disabled={!!l.debit.trim()} onChange={(e) => set(i, { credit: e.target.value })} aria-label={`Line ${i + 1} credit`} />
                        {bad && <p className="mt-0.5 text-right text-caption text-error-fg">Not an amount</p>}
                      </td>
                      <td className="py-1 pr-2"><ProjectSelect className={`${cell} w-44`} value={l.projectId} onChange={(v) => set(i, { projectId: v })} /></td>
                      <td className="py-1">
                        <button type="button" className="p-1.5 text-ink-400 hover:text-ink-900 disabled:opacity-30" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label={`Remove line ${i + 1}`}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-200">
                  <td className="pt-3">
                    <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={() => setLines([...lines, blank()])}>
                      <Plus size={12} /> Add line
                    </button>
                  </td>
                  <td className="pt-3 pr-2 text-right text-caption font-medium text-ink-500">Totals</td>
                  <td className="pt-3 pr-2 text-right font-mono tabular-nums text-body text-ink-900">{formatPaise(debit)}</td>
                  <td className="pt-3 pr-2 text-right font-mono tabular-nums text-body text-ink-900">{formatPaise(credit)}</td>
                  <td className="pt-3 pr-2 text-caption" colSpan={2}>
                    {debit === 0 && credit === 0 ? (
                      <span className="text-ink-500">Enter the amounts.</span>
                    ) : difference === 0 ? (
                      <span className="text-success-fg">Balanced</span>
                    ) : (
                      <span className="font-mono text-error-fg">Out by {formatPaise(Math.abs(difference))} ({difference > 0 ? 'more debit' : 'more credit'})</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      </FormPage>
    </div>
  );
}
