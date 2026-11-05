'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AccountSelect, Notice, errorText, isPartyAccount, shortDate, useAccounts } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface BulkLine {
  journalId: string;
  index: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  narration: string | null;
  description: string;
  debitPaise: number;
  creditPaise: number;
  projectId: string | null;
  movedBy: { proposalId: string; status: 'proposed' | 'approved' } | null;
}
interface Criteria { accountId: string; from: string; to: string; text: string }
interface Proposed { proposalId: string; amountPaise: number; direction: 'debit' | 'credit'; date: string; period: string; lines: number }

const key = (l: { journalId: string; index: number }) => `${l.journalId}:${l.index}`;
const fyStart = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
};

/**
 * Move posted lines from one account to another. Nothing posted is edited:
 * the move is one reclassification in the review queue, posted on approval.
 */
export default function BulkUpdatePage() {
  const qc = useQueryClient();
  const accounts = useAccounts().data ?? [];
  const [form, setForm] = useState<Criteria>({ accountId: '', from: fyStart(), to: new Date().toISOString().slice(0, 10), text: '' });
  const [search, setSearch] = useState<Criteria | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toAccountId, setToAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<Proposed | null>(null);

  const q = useQuery({
    queryKey: ['bulk-update', 'lines', search],
    enabled: !!search,
    queryFn: () => {
      const p = new URLSearchParams({ accountId: search!.accountId });
      if (search!.from) p.set('from', search!.from);
      if (search!.to) p.set('to', search!.to);
      if (search!.text.trim()) p.set('text', search!.text.trim());
      return api.get<{ lines: BulkLine[]; capped: boolean }>(`/month-end/bulk-update/lines?${p.toString()}`);
    },
  });

  const lines = q.data?.lines ?? [];
  const open = lines.filter((l) => !l.movedBy);
  const chosen = open.filter((l) => picked.has(key(l)));
  const net = chosen.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
  const fromAccount = accounts.find((a) => a._id === search?.accountId);
  const toAccount = accounts.find((a) => a._id === toAccountId);
  const allPicked = open.length > 0 && chosen.length === open.length;

  const propose = useMutation({
    mutationFn: () =>
      api.post<Proposed>('/month-end/bulk-update/propose', {
        fromAccountId: search!.accountId,
        toAccountId,
        lines: chosen.map((l) => ({ journalId: l.journalId, index: l.index })),
        reason: reason.trim() || undefined,
      }),
    onSuccess: (r) => {
      setDone(r);
      setPicked(new Set());
      setReason('');
      void qc.invalidateQueries({ queryKey: ['bulk-update'] });
      void qc.invalidateQueries({ queryKey: ['workspace'] });
      notify('Sent to the review queue');
    },
    onError: (err) => notify(errorText(err, "Couldn't propose the reclassification."), 'error'),
  });

  const find = () => {
    if (!form.accountId) return notify('Choose the account to look in.', 'error');
    if (form.from && form.to && form.from > form.to) return notify('The start date is after the end date.', 'error');
    setPicked(new Set());
    setDone(null);
    setToAccountId((t) => (t === form.accountId ? '' : t));
    setSearch({ ...form });
  };
  const toggle = (l: BulkLine) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key(l))) next.delete(key(l));
      else next.add(key(l));
      return next;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        guide="bulkUpdate"
        title="Bulk update"
        subtitle="Find posted lines booked to the wrong account and move them in one entry. The original vouchers are never edited: the move is a reclassification you approve in the review queue."
      />

      <Section title="Find transactions">
        <form
          className="grid items-end gap-4 md:grid-cols-[2fr_1fr_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <Field label="Account" required>
            <AccountSelect className={inputClass} value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} hide={isPartyAccount} />
          </Field>
          <Field label="From">
            <input type="date" className={inputClass} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </Field>
          <Field label="Narration or description contains">
            <input className={inputClass} value={form.text} maxLength={100} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="printer" />
          </Field>
          <Button type="submit" disabled={q.isFetching}><Search size={14} /> Find transactions</Button>
        </form>
      </Section>

      {done && (
        <Notice tone="success">
          Sent to the review queue: {done.lines} line{done.lines === 1 ? '' : 's'}, {formatPaise(done.amountPaise)}, dated {shortDate(done.date)}. It posts when someone presses Approve &amp; post.{' '}
          <Link href="/review" className="font-medium underline">Open the review queue</Link>
        </Notice>
      )}

      {search && (
        <Section
          title={fromAccount ? `Posted lines on ${fromAccount.name}` : 'Posted lines'}
          description={`${search.from ? shortDate(search.from) : 'The start'} to ${search.to ? shortDate(search.to) : 'today'}${search.text.trim() ? `, containing “${search.text.trim()}”` : ''}. Reversed entries are left out.`}
        >
          {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the ledger…</p>}
          {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
          {q.data && lines.length === 0 && <EmptyState title="No posted lines match" body="Widen the dates, or change the text." />}
          {q.data?.capped && <p className="mb-2 text-caption text-pending-fg">Showing the first 500 lines: narrow the dates or the text to see the rest.</p>}
          {lines.length > 0 && (
            <TableCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className={`${th} w-10`}>
                      <input
                        type="checkbox"
                        aria-label="Choose every line"
                        checked={allPicked}
                        disabled={!open.length}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(open.map(key)))}
                      />
                    </th>
                    <th className={th}>Voucher</th>
                    <th className={th}>Date</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>Debit</th>
                    <th className={`${th} text-right`}>Credit</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={key(l)} className={`border-b border-line-100 last:border-0 ${l.movedBy ? 'opacity-60' : 'cursor-pointer hover:bg-surface-sink'}`} onClick={() => !l.movedBy && toggle(l)}>
                      <td className={td}>
                        <input type="checkbox" aria-label={`Choose ${l.voucherNumber} line ${l.index + 1}`} checked={picked.has(key(l))} disabled={!!l.movedBy} onChange={() => toggle(l)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className={`${td} font-mono text-caption`}>
                        <Link href={`/accountant/manual-journals/${l.journalId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{l.voucherNumber}</Link>
                      </td>
                      <td className={`${td} whitespace-nowrap text-ink-600`}>{shortDate(l.date)}</td>
                      <td className={`${td} max-w-[360px]`}>
                        <p className="truncate">{l.narration ?? '—'}</p>
                        {l.description && l.description !== l.narration && <p className="truncate text-caption text-ink-500">{l.description}</p>}
                      </td>
                      <td className={tdMoney}>{l.debitPaise ? formatPaise(l.debitPaise) : ''}</td>
                      <td className={tdMoney}>{l.creditPaise ? formatPaise(l.creditPaise) : ''}</td>
                      <td className={td}>
                        {l.movedBy?.status === 'proposed' && <StatusChip tone="pending">In review</StatusChip>}
                        {l.movedBy?.status === 'approved' && <StatusChip tone="success">Moved</StatusChip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        </Section>
      )}

      {search && open.length > 0 && (
        <Section title="Move the chosen lines" description="One reclassification for their net: the new account is debited and the old one credited (the other way round for a net credit).">
          <div className="grid items-end gap-4 md:grid-cols-[2fr_3fr_auto]">
            <Field label="Move to" required>
              <AccountSelect className={inputClass} value={toAccountId} onChange={setToAccountId} exclude={search.accountId} hide={isPartyAccount} />
            </Field>
            <Field label="Reason" hint="Shown to the reviewer and kept with the entry.">
              <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Repairs booked to rent by mistake" />
            </Field>
            <Button disabled={!chosen.length || !toAccountId || net === 0 || propose.isPending} onClick={() => propose.mutate()}>
              {propose.isPending ? 'Proposing…' : 'Propose reclassification'}
            </Button>
          </div>
          <p className="mt-3 text-body text-ink-700">
            {chosen.length ? (
              <>
                {chosen.length} of {open.length} line{open.length === 1 ? '' : 's'} chosen, net{' '}
                <span className="font-mono tabular-nums">{net >= 0 ? 'debit' : 'credit'} {formatPaise(Math.abs(net))}</span>
                {toAccount && fromAccount && net !== 0 && (
                  <span className="text-ink-500">
                    {' '}· Dr {net > 0 ? toAccount.name : fromAccount.name} / Cr {net > 0 ? fromAccount.name : toAccount.name}
                  </span>
                )}
                {net === 0 && <span className="text-ink-500"> · they net to nothing, so there is nothing to move</span>}
              </>
            ) : (
              <span className="text-ink-500">Choose the lines to move.</span>
            )}
          </p>
        </Section>
      )}
    </div>
  );
}
