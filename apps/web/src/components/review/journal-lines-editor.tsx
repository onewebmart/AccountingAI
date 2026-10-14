'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn, formatRupees } from '@/lib/utils';

export interface JournalLineDraft {
  accountId: string;
  accountName: string;
  debitPaise: number;
  creditPaise: number;
}

export interface PostingAccount {
  _id: string;
  name: string;
  code: string;
}

/** Totals and whether the lines can be posted (balanced, non-zero, every line has an account). */
export function linesStatus(lines: JournalLineDraft[]) {
  const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
  const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
  const complete = lines.every((l) => l.accountId && (l.debitPaise > 0 || l.creditPaise > 0));
  return { debit, credit, postable: complete && debit === credit && debit > 0 };
}

/**
 * Typed in rupees, held as integer paise. Keeps its own text so "12." can be
 * typed on the way to "12.50" without the field snapping back.
 */
function MoneyInput({ paise, onChange, label }: { paise: number; onChange: (paise: number) => void; label: string }) {
  const [text, setText] = useState(paise ? (paise / 100).toFixed(2) : '');
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder="0.00"
      onChange={(e) => {
        const next = e.target.value.replace(/,/g, '');
        if (!/^\d*(\.\d{0,2})?$/.test(next)) return;
        setText(next);
        onChange(next ? Math.round(parseFloat(next) * 100) : 0);
      }}
      className="w-28 rounded border border-line-200 bg-surface-card px-2 py-1 text-right font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400"
    />
  );
}

interface JournalLinesEditorProps {
  lines: JournalLineDraft[];
  editing: boolean;
  accounts: PostingAccount[];
  onChange: (lines: JournalLineDraft[]) => void;
}

/** The journal a proposal will post — read-only, or editable line by line. */
export function JournalLinesEditor({ lines, editing, accounts, onChange }: JournalLinesEditorProps) {
  const { debit, credit } = linesStatus(lines);
  const difference = debit - credit;

  const update = (index: number, patch: Partial<JournalLineDraft>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  return (
    <div className="rounded-md border border-line-200">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200 bg-surface-sink/60">
            <th className="px-3 py-2 text-caption font-semibold uppercase tracking-wide text-ink-500">Account</th>
            <th className="px-3 py-2 text-right text-caption font-semibold uppercase tracking-wide text-ink-500">Debit</th>
            <th className="px-3 py-2 text-right text-caption font-semibold uppercase tracking-wide text-ink-500">Credit</th>
            {editing && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-b border-line-100 last:border-0">
              <td className="px-3 py-1.5 text-body text-ink-900">
                {editing ? (
                  <select
                    aria-label={`Account for line ${i + 1}`}
                    value={line.accountId}
                    onChange={(e) => {
                      const account = accounts.find((a) => a._id === e.target.value);
                      update(i, { accountId: e.target.value, accountName: account?.name ?? '' });
                    }}
                    className="w-full rounded border border-line-200 bg-surface-card px-2 py-1 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400"
                  >
                    <option value="">Choose an account…</option>
                    {/* Keep a suggested account selectable even if the list has not loaded it. */}
                    {line.accountId && !accounts.some((a) => a._id === line.accountId) && (
                      <option value={line.accountId}>{line.accountName}</option>
                    )}
                    {accounts.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  line.accountName
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-body text-ink-900">
                {editing ? (
                  <MoneyInput label={`Debit for line ${i + 1}`} paise={line.debitPaise} onChange={(p) => update(i, { debitPaise: p })} />
                ) : line.debitPaise > 0 ? (
                  formatRupees(line.debitPaise)
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-body text-ink-900">
                {editing ? (
                  <MoneyInput label={`Credit for line ${i + 1}`} paise={line.creditPaise} onChange={(p) => update(i, { creditPaise: p })} />
                ) : line.creditPaise > 0 ? (
                  formatRupees(line.creditPaise)
                ) : (
                  '—'
                )}
              </td>
              {editing && (
                <td className="pr-2">
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    className="rounded p-1 text-ink-400 hover:bg-surface-sink hover:text-error-fg"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-200">
            <td className="px-3 py-2 text-caption text-ink-500">
              {editing && (
                <button
                  type="button"
                  onClick={() => onChange([...lines, { accountId: '', accountName: '', debitPaise: 0, creditPaise: 0 }])}
                  className="inline-flex items-center gap-1 text-caption font-medium text-ink-700 hover:text-ink-900"
                >
                  <Plus size={12} /> Add line
                </button>
              )}
            </td>
            <td className="px-3 py-2 text-right font-mono text-body font-semibold text-ink-900">{formatRupees(debit)}</td>
            <td className="px-3 py-2 text-right font-mono text-body font-semibold text-ink-900">{formatRupees(credit)}</td>
            {editing && <td />}
          </tr>
        </tfoot>
      </table>
      {difference !== 0 && (
        <p className={cn('border-t border-line-200 px-3 py-2 text-caption font-medium text-error-fg')}>
          Debits and credits differ by {formatRupees(Math.abs(difference))} — they must match before this can post.
        </p>
      )}
    </div>
  );
}
