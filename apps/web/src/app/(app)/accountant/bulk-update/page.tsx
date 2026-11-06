'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { SearchSelect } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { AccountSelect, Notice, errorText, isPartyAccount, shortDate, todayIso, useAccounts } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';

interface Contact { id: string; name: string; kind: 'customer' | 'vendor' }
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
  contact: Contact | null;
  movedBy: { proposalId: string; status: 'proposed' | 'approved' } | null;
}
/** What the filter asks for; amounts are kept as typed, in rupees. */
interface Criteria { accountId: string; contactId: string; from: string; to: string; min: string; max: string; text: string }
interface Entry { proposalId: string; month: string | null; amountPaise: number; direction: 'debit' | 'credit'; date: string; period: string; lines: number }
interface Proposed { split: 'month' | 'single'; entries: Entry[]; lines: number; skipped: string[] }
type Split = 'month' | 'single';

const key = (l: { journalId: string; index: number }) => `${l.journalId}:${l.index}`;
const fyStart = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const blank: Criteria = { accountId: '', contactId: '', from: fyStart(), to: todayIso(), min: '', max: '', text: '' };

/**
 * Move posted lines from one account to another. Nothing posted is edited:
 * the move is a reclassification in the review queue (one per month the
 * lines are in, or one for all), posted when someone approves it.
 */
export default function BulkUpdatePage() {
  const qc = useQueryClient();
  const accounts = useAccounts().data ?? [];
  const contacts = useQuery({ queryKey: ['bulk-update', 'contacts'], queryFn: () => api.get<Contact[]>('/month-end/bulk-update/contacts') });
  const [form, setForm] = useState<Criteria>(blank);
  const [search, setSearch] = useState<(Criteria & { minPaise: number | null; maxPaise: number | null }) | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toAccountId, setToAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [split, setSplit] = useState<Split | null>(null);
  const [done, setDone] = useState<Proposed | null>(null);

  const q = useQuery({
    queryKey: ['bulk-update', 'lines', search],
    enabled: !!search,
    queryFn: () => {
      const p = new URLSearchParams({ accountId: search!.accountId });
      if (search!.contactId) p.set('contactId', search!.contactId);
      if (search!.from) p.set('from', search!.from);
      if (search!.to) p.set('to', search!.to);
      if (search!.minPaise !== null) p.set('minPaise', String(search!.minPaise));
      if (search!.maxPaise !== null) p.set('maxPaise', String(search!.maxPaise));
      if (search!.text.trim()) p.set('text', search!.text.trim());
      return api.get<{ lines: BulkLine[]; capped: boolean; contact: Contact | null }>(`/month-end/bulk-update/lines?${p.toString()}`);
    },
  });

  const lines = q.data?.lines ?? [];
  const open = lines.filter((l) => !l.movedBy);
  const chosen = open.filter((l) => picked.has(key(l)));
  const net = chosen.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
  const fromAccount = accounts.find((a) => a._id === search?.accountId);
  const toAccount = accounts.find((a) => a._id === toAccountId);
  const allPicked = open.length > 0 && chosen.length === open.length;

  // The months the chosen lines are in: over more than one, one entry each unless asked otherwise.
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of chosen) m.set(l.date.slice(0, 7), (m.get(l.date.slice(0, 7)) ?? 0) + l.debitPaise - l.creditPaise);
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  }, [chosen]);
  const spans = byMonth.length > 1;
  const effective: Split = split ?? (spans ? 'month' : 'single');
  const today = todayIso();
  const dated = (m: string) => (monthEnd(m) > today ? today : monthEnd(m));
  const entries = effective === 'month' && spans
    ? byMonth.filter(([, n]) => n !== 0).map(([m, n]) => ({ month: m, net: n, date: dated(m) }))
    : net !== 0 ? [{ month: byMonth.length ? byMonth[byMonth.length - 1][0] : '', net, date: byMonth.length ? dated(byMonth[byMonth.length - 1][0]) : today }] : [];
  const nilMonths = effective === 'month' && spans ? byMonth.filter(([, n]) => n === 0).map(([m]) => m) : [];

  const propose = useMutation({
    mutationFn: () =>
      api.post<Proposed>('/month-end/bulk-update/propose', {
        fromAccountId: search!.accountId,
        toAccountId,
        lines: chosen.map((l) => ({ journalId: l.journalId, index: l.index })),
        reason: reason.trim() || undefined,
        split: effective,
      }),
    onSuccess: (r) => {
      setDone(r);
      setPicked(new Set());
      setReason('');
      setSplit(null);
      void qc.invalidateQueries({ queryKey: ['bulk-update'] });
      void qc.invalidateQueries({ queryKey: ['workspace'] });
      notify(r.entries.length === 1 ? 'Sent to the review queue' : `${r.entries.length} entries sent to the review queue`);
    },
    onError: (err) => notify(errorText(err, "Couldn't propose the reclassification."), 'error'),
  });

  const find = () => {
    if (!form.accountId) return notify('Choose the account to look in.', 'error');
    if (form.from && form.to && form.from > form.to) return notify('The start date is after the end date.', 'error');
    const minPaise = form.min.trim() ? parseRupees(form.min) : null;
    const maxPaise = form.max.trim() ? parseRupees(form.max) : null;
    if ((form.min.trim() && (minPaise === null || minPaise < 0)) || (form.max.trim() && (maxPaise === null || maxPaise < 0))) return notify('Type amounts in rupees, like 5,000.', 'error');
    if (minPaise !== null && maxPaise !== null && minPaise > maxPaise) return notify('The smallest amount is more than the largest.', 'error');
    setPicked(new Set());
    setDone(null);
    setSplit(null);
    setToAccountId((t) => (t === form.accountId ? '' : t));
    setSearch({ ...form, minPaise, maxPaise });
  };
  const toggle = (l: BulkLine) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key(l))) next.delete(key(l));
      else next.add(key(l));
      return next;
    });

  const contactOptions = (contacts.data ?? []).map((c) => ({ value: c.id, label: c.name, group: c.kind === 'customer' ? 'Customers' : 'Vendors', detail: c.kind === 'customer' ? 'Customer' : 'Vendor' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  const contactName = (contacts.data ?? []).find((c) => c.id === search?.contactId)?.name;
  const described = search
    ? [
        `${search.from ? shortDate(search.from) : 'The start'} to ${search.to ? shortDate(search.to) : 'today'}`,
        contactName ? `with ${contactName}` : null,
        search.minPaise !== null || search.maxPaise !== null
          ? `lines of ${search.minPaise !== null ? formatPaise(search.minPaise) : '₹0'}${search.maxPaise !== null ? ` to ${formatPaise(search.maxPaise)}` : ' or more'}`
          : null,
        search.text.trim() ? `containing “${search.text.trim()}”` : null,
      ].filter(Boolean).join(', ')
    : '';

  return (
    <div className="space-y-5">
      <PageHeader
        guide="bulkUpdate"
        title="Bulk update"
        subtitle="Find posted lines booked to the wrong account and move them. The original vouchers are never edited: the move is a reclassification you approve in the review queue."
      />

      <Section title="Filter transactions" description="The account is required; the rest narrow the search. The amount range is on each line's own debit or credit.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Account" required>
              <AccountSelect className={inputClass} value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} hide={isPartyAccount} />
            </Field>
            <Field label="Contact" hint="The customer or vendor on the invoice, bill, note, receipt, payment or expense that posted the voucher.">
              <SearchSelect
                className="w-full"
                value={form.contactId}
                onChange={(v) => setForm({ ...form, contactId: v })}
                options={contactOptions}
                noneLabel="Any contact"
                placeholder="Any contact"
                searchPlaceholder="Type a customer or vendor"
                aria-label="Contact"
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_1fr]">
            <Field label="Date from">
              <input type="date" className={inputClass} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </Field>
            <Field label="Date to">
              <input type="date" className={inputClass} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </Field>
            <Field label="Amount from (₹)">
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Amount to (₹)">
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} placeholder="Any" />
            </Field>
          </div>
          <div className="grid items-end gap-4 md:grid-cols-[2fr_auto_auto]">
            <Field label="Narration or description contains">
              <input className={inputClass} value={form.text} maxLength={100} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="printer" />
            </Field>
            <Button type="button" variant="secondary" onClick={() => setForm({ ...blank, accountId: form.accountId })}><RotateCcw size={14} /> Clear filters</Button>
            <Button type="submit" disabled={q.isFetching}><Search size={14} /> Search</Button>
          </div>
        </form>
      </Section>

      {done && (
        <Notice tone="success">
          Sent to the review queue: {done.lines} line{done.lines === 1 ? '' : 's'} in {done.entries.length} entr{done.entries.length === 1 ? 'y' : 'ies'}
          {' '}({done.entries.map((e) => `${formatPaise(e.amountPaise)} dated ${shortDate(e.date)}`).join('; ')}).
          {done.skipped.length > 0 && <> {done.skipped.map(monthLabel).join(', ')} netted to nothing, so {done.skipped.length === 1 ? 'it was' : 'they were'} left as they are.</>}
          {' '}Each posts when someone presses Approve &amp; post.{' '}
          <Link href="/review" className="font-medium underline">Open the review queue</Link>
        </Notice>
      )}

      {search && (
        <Section
          title={fromAccount ? `Posted lines on ${fromAccount.name}` : 'Posted lines'}
          description={`${described}. Reversed entries are left out.`}
        >
          {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the ledger…</p>}
          {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
          {q.data && lines.length === 0 && <EmptyState title="No posted lines match" body="Widen the dates or the amounts, or clear the contact or the text." />}
          {q.data?.capped && <p className="mb-2 text-caption text-pending-fg">Showing the first 500 lines: narrow the filter to see the rest.</p>}
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
                    <th className={th}>Contact</th>
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
                      <td className={`${td} max-w-[180px]`}>
                        {l.contact ? <p className="truncate">{l.contact.name}</p> : <span className="text-ink-400">—</span>}
                      </td>
                      <td className={`${td} max-w-[320px]`}>
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
        <Section title="Move the chosen lines" description="A reclassification for their net: the new account is debited and the old one credited (the other way round for a net credit).">
          <div className="grid items-start gap-4 md:grid-cols-[2fr_3fr]">
            <Field label="Move to" required>
              <AccountSelect className={inputClass} value={toAccountId} onChange={setToAccountId} exclude={search.accountId} hide={isPartyAccount} />
            </Field>
            <Field label="Reason" hint="Shown to the reviewer and kept with the entry.">
              <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Repairs booked to rent by mistake" />
            </Field>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-1 text-caption font-medium text-ink-700">Entries</legend>
            <div className="flex flex-wrap gap-4 text-body text-ink-800">
              <label className="flex items-center gap-2">
                <input type="radio" name="split" checked={effective === 'month'} onChange={() => setSplit('month')} />
                One entry per month{spans ? ' (recommended: the lines span months)' : ''}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="split" checked={effective === 'single'} onChange={() => setSplit('single')} />
                One entry for all
              </label>
            </div>
            <p className="mt-1 text-caption text-ink-500">
              Per month, each month&apos;s lines move at that month&apos;s end, so the monthly profit and loss moves where the lines are. One entry for all is dated at the end of the latest line&apos;s month. A locked month moves the day after the lock.
            </p>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button disabled={!chosen.length || !toAccountId || net === 0 || propose.isPending} onClick={() => propose.mutate()}>
              {propose.isPending ? 'Proposing…' : 'Propose reclassification'}
            </Button>
            <p className="text-body text-ink-700">
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
          </div>

          {entries.length > 0 && chosen.length > 0 && (
            <div className="mt-3 max-w-xl">
              <TableCard>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-200 bg-surface-sink">
                      <th className={th}>{effective === 'month' && spans ? 'Month' : 'Entry'}</th>
                      <th className={th}>Dated</th>
                      <th className={`${th} text-right`}>Moves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.month || 'all'} className="border-b border-line-100 last:border-0">
                        <td className={td}>{effective === 'month' && spans ? monthLabel(e.month) : 'All the chosen lines'}</td>
                        <td className={`${td} whitespace-nowrap text-ink-600`}>{shortDate(e.date)}</td>
                        <td className={tdMoney}>{e.net > 0 ? 'Dr' : 'Cr'} {formatPaise(Math.abs(e.net))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
              {nilMonths.length > 0 && <p className="mt-1 text-caption text-ink-500">{nilMonths.map(monthLabel).join(', ')} {nilMonths.length === 1 ? 'nets to nothing and is left as it is' : 'net to nothing and are left as they are'}.</p>}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
