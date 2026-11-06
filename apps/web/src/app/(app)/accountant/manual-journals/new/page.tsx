'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { Notice, errorText, isApprovalHold, shortDate, todayIso } from '@/components/accountant/common';
import { AccountPicker, ContactPicker, useContactOptions } from '@/components/accountant/pickers';
import type { JournalItem } from '@/components/accountant/journal-types';
import { ProjectSelect, useProjects } from '@/components/projects/project-select';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { DocumentEntry, EntryActions, scanSummary, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

interface Line { key: number; accountId: string; description: string; contact: string; projectId: string; debit: string; credit: string }
let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, accountId: '', description: '', contact: '', projectId: '', debit: '', credit: '' });
const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40 disabled:bg-surface-sink';
const NOTES_MAX = 500;
const MAX_FILE = 15 * 1024 * 1024;

/** Paise from a typed amount: 0 when blank, null when it is not an amount or is negative. */
const amount = (v: string) => {
  const p = parseRupees(v);
  return p === null || p < 0 ? null : p;
};
const fileSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Opened from a scan (?document=), the file shows beside the journal: its date and notes come from it, the accounts from the person. */
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
  const contacts = useContactOptions();
  const projects = useProjects();
  const [date, setDate] = useState(todayIso());
  const [ownNumber, setOwnNumber] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [reverseOn, setReverseOn] = useState('');
  const [onlyOnDate, setOnlyOnDate] = useState(true);
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const next = useQuery({
    queryKey: ['journals', 'next-number', date],
    queryFn: () => api.get<{ voucherNumber: string }>(`/journals/next-number?date=${date}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });

  // From a scan: the date, and notes naming the document. Which accounts move is the person's call.
  usePrefill((x) => {
    if (x.date) setDate(x.date);
    setNotes((n) => n || scanSummary(x).slice(0, NOTES_MAX));
  });

  // A row just added gets the cursor, in its account.
  useEffect(() => {
    if (focusRow === null) return;
    document.getElementById(`jl-account-${focusRow}`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const set = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addRow = () => {
    const row = blank();
    setLines((all) => [...all, row]);
    setFocusRow(row.key);
  };
  const used = lines.filter((l) => l.accountId || l.debit.trim() || l.credit.trim() || l.description.trim());
  const debit = used.reduce((s, l) => s + (amount(l.debit) ?? 0), 0);
  const credit = used.reduce((s, l) => s + (amount(l.credit) ?? 0), 0);
  const difference = debit - credit;
  const balanced = debit > 0 && difference === 0;
  const reverseBad = !!reverseOn && reverseOn <= date;
  const withProjects = (projects.data?.length ?? 0) > 0;

  /** Enter in a line's amount moves to the next line, adding one at the end; it never submits. */
  const onAmountKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i === lines.length - 1) addRow();
    else document.getElementById(`jl-account-${lines[i + 1].key}`)?.focus();
  };

  const post = useMutation({
    mutationFn: () => {
      const body = used.map((l, n) => {
        const d = amount(l.debit);
        const c = amount(l.credit);
        if (!l.accountId) throw new Error(`Line ${n + 1}: choose an account.`);
        if (d === null || c === null) throw new Error(`Line ${n + 1}: enter amounts in rupees, like 25,000.50.`);
        if ((d > 0) === (c > 0)) throw new Error(`Line ${n + 1}: enter a debit or a credit, not both and not neither.`);
        const [kind, id] = l.contact.split(':');
        return {
          accountId: l.accountId,
          description: l.description.trim() || undefined,
          debitPaise: d,
          creditPaise: c,
          projectId: l.projectId || null,
          contact: l.contact ? { kind, id } : null,
        };
      });
      if (!notes.trim()) throw new Error('Add notes: say why this entry is made.');
      if (body.length < 2) throw new Error('A journal needs at least two lines.');
      if (debit !== credit) throw new Error(`Debits and credits differ by ${formatPaise(Math.abs(difference))}.`);
      if (debit === 0) throw new Error('A journal must move some amount.');
      if (ownNumber !== null && !ownNumber.trim()) throw new Error('Type your Journal#, or use the automatic number.');
      if (reverseBad) throw new Error('The reverse journal date must be after the journal date.');
      return api.post<JournalItem>('/journals', {
        voucherType: 'JOURNAL',
        date,
        narration: notes.trim(),
        reference: reference.trim() || null,
        journalNumber: ownNumber?.trim() || null,
        reverseOn: reverseOn || null,
        publishReversalOnDate: onlyOnDate,
        lines: body,
      });
    },
    onMutate: () => setError(null),
    onSuccess: async (j) => {
      void qc.invalidateQueries({ queryKey: ['journals'] });
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      // The files go to the journal now that it exists.
      let failed = 0;
      for (const f of files) {
        const form = new FormData();
        form.append('entityType', 'Journal');
        form.append('entityId', j._id);
        form.append('file', f);
        try {
          await api.post('/attachments', form);
        } catch {
          failed++;
        }
      }
      notify('Journal posted');
      if (failed) notify(`${failed} attachment${failed === 1 ? '' : 's'} couldn't be uploaded. Add ${failed === 1 ? 'it' : 'them'} from the journal's page.`, 'error');
      return entry.finish({ entityType: 'Journal', entityId: j._id, label: `Journal ${j.journalNumber ?? j.voucherNumber}` }, `/accountant/manual-journals/${j._id}`);
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
        {(files.length > 0 || entry.active) && (
          <p className="text-body text-ink-600">Attach the files from the journal&apos;s page once it is approved.</p>
        )}
        <div className="flex gap-2">
          <Button asChild><Link href="/approvals">Open approvals</Link></Button>
          <Button variant="secondary" onClick={() => { setHeld(null); setLines([blank(), blank()]); setNotes(''); setReference(''); setOwnNumber(null); setReverseOn(''); setFiles([]); }}>New journal</Button>
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
            <Button type="submit" disabled={post.isPending || !balanced}>{post.isPending ? 'Posting…' : 'Post journal'}</Button>
            {/* Like Post journal, it waits for a balanced entry; Skip for now does not. */}
            <EntryActions busy={post.isPending} nextLabel="Post and next" nextDisabled={!balanced} />
            <Button type="button" variant="secondary" asChild><Link href="/accountant/manual-journals">Cancel</Link></Button>
            <span className={cn('ml-auto font-mono text-body tabular-nums', difference === 0 ? 'text-ink-700' : 'text-error-fg')}>
              {difference === 0 ? `Dr ${formatPaise(debit)} · Cr ${formatPaise(credit)}` : `Difference ${formatPaise(Math.abs(difference))}`}
            </span>
          </>
        }
      >
        <Section>
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Date" required>
                <input type="date" className={`${inputClass} max-w-[220px]`} value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field
                label="Journal#"
                required
                hint={
                  ownNumber === null
                    ? 'Given automatically when it posts, in the JNL series.'
                    : 'Your own number, used once. The journal still gets its JNL voucher number, so the series has no gaps.'
                }
              >
                <div className="flex max-w-[360px] items-center gap-2">
                  {ownNumber === null ? (
                    <input className={`${inputClass} font-mono`} value={next.data?.voucherNumber ?? 'JNL/…'} readOnly aria-label="Journal number, automatic" tabIndex={-1} />
                  ) : (
                    <input className={`${inputClass} font-mono`} value={ownNumber} maxLength={30} autoFocus onChange={(e) => setOwnNumber(e.target.value)} placeholder="ADJ-2026-014" aria-label="Your own journal number" />
                  )}
                  <button
                    type="button"
                    className="rounded-md border border-line-200 p-2 text-ink-500 hover:bg-surface-sink hover:text-ink-900"
                    onClick={() => setOwnNumber(ownNumber === null ? '' : null)}
                    title={ownNumber === null ? 'Type your own Journal#' : 'Use the automatic number'}
                    aria-label={ownNumber === null ? 'Type your own Journal#' : 'Use the automatic number'}
                  >
                    {ownNumber === null ? <Settings2 size={16} /> : <X size={16} />}
                  </button>
                </div>
              </Field>
              <Field label="Reference#">
                <input className={`${inputClass} max-w-[360px]`} value={reference} maxLength={50} onChange={(e) => setReference(e.target.value)} placeholder="Audit note 14, file no." />
              </Field>
            </div>

            <div className="space-y-4">
              <Field label="Notes" required hint={<span className="flex justify-between"><span>Why the entry is made: it is printed on the voucher and kept in the audit trail.</span><span className="font-mono">{notes.length}/{NOTES_MAX}</span></span>}>
                <textarea className={`${inputClass} min-h-[92px]`} value={notes} maxLength={NOTES_MAX} onChange={(e) => setNotes(e.target.value)} placeholder="Provision for audit fees, FY 2026-27" required />
              </Field>
              <Field label="Reverse Journal Date" hint={reverseOn && !reverseBad ? (onlyOnDate ? `The reversal posts on ${shortDate(reverseOn)}, in the 6:30 am daily run. Until then it is not in the ledger.` : `The reversal posts now, with this journal, dated ${shortDate(reverseOn)}.`) : 'For an accrual or provision that cancels itself, such as on the 1st of next month.'}>
                <input type="date" className={cn(inputClass, 'max-w-[220px]', reverseBad && 'border-error-fg')} value={reverseOn} min={date} onChange={(e) => setReverseOn(e.target.value)} aria-invalid={reverseBad} />
                {reverseBad && <p className="mt-1 text-caption text-error-fg">The reverse date must be after the journal date.</p>}
              </Field>
              <label className={cn('flex items-start gap-2 text-body', reverseOn ? 'text-ink-900' : 'text-ink-400')}>
                <input type="checkbox" className="mt-1" checked={onlyOnDate} disabled={!reverseOn} onChange={(e) => setOnlyOnDate(e.target.checked)} />
                Publish reverse journal only on the reverse journal date
              </label>
              <Field label="Currency" hint="Journals are kept in your base currency.">
                <p className="text-body text-ink-700">INR, Indian Rupee</p>
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Lines" description="One account per line, with a debit or a credit. Enter in an amount moves to the next line.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col />
                <col className="w-[18%]" />
                {withProjects && <col className="w-[13%]" />}
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-9" />
              </colgroup>
              <thead>
                <tr className="border-b border-line-200 text-left text-caption font-semibold uppercase tracking-wide text-ink-500">
                  <th className="pb-2 pr-2">Account</th>
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2">Contact (INR)</th>
                  {withProjects && <th className="pb-2 pr-2">Project</th>}
                  <th className="pb-2 pr-2 text-right">Debits</th>
                  <th className="pb-2 pr-2 text-right">Credits</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const bad = amount(l.debit) === null || amount(l.credit) === null;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="py-1.5 pr-2">
                        <AccountPicker id={`jl-account-${l.key}`} value={l.accountId} onChange={(v) => set(l.key, { accountId: v })} aria-label={`Line ${i + 1} account`} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input className={cell} value={l.description} maxLength={500} onChange={(e) => set(l.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <ContactPicker value={l.contact} onChange={(v) => set(l.key, { contact: v })} options={contacts} aria-label={`Line ${i + 1} contact`} />
                      </td>
                      {withProjects && (
                        <td className="py-1.5 pr-2">
                          <ProjectSelect className={cell} value={l.projectId} onChange={(v) => set(l.key, { projectId: v })} />
                        </td>
                      )}
                      <td className="py-1.5 pr-2">
                        <input
                          className={`${cell} text-right font-mono tabular-nums`}
                          inputMode="decimal"
                          value={l.debit}
                          disabled={!!l.credit.trim()}
                          onChange={(e) => set(l.key, { debit: e.target.value })}
                          onKeyDown={(e) => onAmountKey(e, i)}
                          aria-label={`Line ${i + 1} debit`}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={`${cell} text-right font-mono tabular-nums`}
                          inputMode="decimal"
                          value={l.credit}
                          disabled={!!l.debit.trim()}
                          onChange={(e) => set(l.key, { credit: e.target.value })}
                          onKeyDown={(e) => onAmountKey(e, i)}
                          aria-label={`Line ${i + 1} credit`}
                        />
                        {bad && <p className="mt-0.5 text-right text-caption text-error-fg">Not an amount</p>}
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="p-2 text-ink-400 hover:text-ink-900 disabled:opacity-30"
                          disabled={lines.length <= 2}
                          onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                          aria-label={`Remove line ${i + 1}`}
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-200 px-3 py-2 text-caption font-medium text-ink-700 hover:border-saffron-600 hover:text-saffron-700" onClick={addRow}>
              <Plus size={13} /> Add New Row
            </button>

            <div className="w-full max-w-[460px] rounded-lg bg-surface-sink p-4">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-2 text-body">
                <span />
                <span className="w-28 text-right text-caption font-semibold uppercase tracking-wide text-ink-500">Debits</span>
                <span className="w-28 text-right text-caption font-semibold uppercase tracking-wide text-ink-500">Credits</span>
                <span className="text-ink-600">Sub Total</span>
                <span className="text-right font-mono tabular-nums text-ink-900">{formatPaise(debit)}</span>
                <span className="text-right font-mono tabular-nums text-ink-900">{formatPaise(credit)}</span>
                <span className="border-t border-line-200 pt-2 font-semibold text-ink-900">Total (₹)</span>
                <span className="border-t border-line-200 pt-2 text-right font-mono font-semibold tabular-nums text-ink-900">{formatPaise(debit)}</span>
                <span className="border-t border-line-200 pt-2 text-right font-mono font-semibold tabular-nums text-ink-900">{formatPaise(credit)}</span>
              </div>
              <div className={cn('mt-3 flex items-center justify-between rounded-md px-3 py-2 text-body', difference === 0 ? 'bg-surface-card text-ink-600' : 'bg-error-bg text-error-fg')}>
                <span className="font-medium">Difference</span>
                <span className="font-mono font-semibold tabular-nums">
                  {difference === 0 ? (debit === 0 ? formatPaise(0) : <span className="text-success-fg">{formatPaise(0)} · Balanced</span>) : `${formatPaise(Math.abs(difference))} ${difference > 0 ? 'more debit' : 'more credit'}`}
                </span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Attachments" description="PDFs or images, up to 15 MB each. They are kept with the journal once it posts.">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const chosen = Array.from(e.target.files ?? []);
              const tooBig = chosen.filter((f) => f.size > MAX_FILE);
              if (tooBig.length) notify(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 15 MB.`, 'error');
              setFiles((all) => [...all, ...chosen.filter((f) => f.size <= MAX_FILE)]);
              e.target.value = '';
            }}
          />
          {files.length > 0 && (
            <ul className="mb-3 divide-y divide-line-100 rounded-md border border-line-200">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-body">
                  <span className="flex min-w-0 items-center gap-2 text-ink-900"><Paperclip size={14} className="shrink-0 text-ink-400" /> <span className="truncate">{f.name}</span></span>
                  <span className="flex items-center gap-3 text-caption text-ink-500">
                    {fileSize(f.size)}
                    <button type="button" className="p-1 text-ink-400 hover:text-ink-900" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`Remove ${f.name}`}><X size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            <Paperclip size={13} /> Attach files
          </Button>
        </Section>
      </FormPage>
    </div>
  );
}
