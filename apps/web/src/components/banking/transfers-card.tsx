'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseRupees } from '@/lib/money';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

interface MoneyLedger {
  _id: string;
  name: string;
  code: string;
  kind: 'bank' | 'cash' | 'gateway' | 'other';
}

type Suggestion =
  | { kind: 'between_accounts'; lineId: string; otherLineId: string; date: string; amountPaise: number; fromBank: string; toBank: string; reason: string }
  | { kind: 'cash_withdrawal' | 'cash_deposit' | 'gateway_settlement'; lineId: string; date: string; amountPaise: number; bank: string; reason: string };

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Money moving between the business's own accounts. Statement lines that
 * look like transfers are suggested; a person confirms each. Cash taken out
 * or paid in posts a contra voucher; a transfer between two bank accounts
 * only pairs the two lines, since both sit on the one Bank ledger.
 */
export function TransfersCard({ onToast }: { onToast: (text: string, error?: boolean) => void }) {
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', amount: '', date: new Date().toISOString().slice(0, 10), narration: '' });

  const ledgers = useQuery({ queryKey: ['banking', 'transfer-ledgers'], queryFn: () => api.get<MoneyLedger[]>('/banking/transfers/ledgers') });
  const suggestions = useQuery({ queryKey: ['banking', 'transfer-suggestions'], queryFn: () => api.get<Suggestion[]>('/banking/transfers/suggestions') });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['banking'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };
  const bank = ledgers.data?.find((l) => l.kind === 'bank');
  const cash = ledgers.data?.find((l) => l.kind === 'cash');
  const gateway = ledgers.data?.find((l) => l.kind === 'gateway');
  // A gateway settlement's fee, per line: what it kept out of what it collected.
  const [fees, setFees] = useState<Record<string, string>>({});

  const record = useMutation({
    mutationFn: (body: { fromAccountId: string; toAccountId: string; amountPaise: number; date: string; narration?: string; bankLineId?: string; feePaise?: number }) =>
      api.post('/banking/transfers', body),
    onSuccess: () => {
      refresh();
      setMoving(false);
      onToast('Transfer posted');
    },
    onError: (err) => onToast(message(err, "Couldn't post the transfer"), true),
  });
  const pair = useMutation({
    mutationFn: (s: { lineId: string; otherLineId: string }) => api.post('/banking/transfers/pair', s),
    onSuccess: () => {
      refresh();
      onToast('Lines paired as a transfer');
    },
    onError: (err) => onToast(message(err, "Couldn't pair those lines"), true),
  });

  const list = suggestions.data ?? [];
  const busy = record.isPending || pair.isPending;
  const amountPaise = parseRupees(form.amount);
  const select = 'rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

  return (
    <section className="rounded-lg border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-body font-semibold text-ink-900">
            <ArrowLeftRight size={15} /> Transfers
          </h2>
          <p className="text-caption text-ink-500">Money between your own accounts: bank to bank, cash withdrawn, cash paid in.</p>
        </div>
        {!moving && (
          <Button
            variant="secondary"
            onClick={() => {
              setForm((f) => ({ ...f, from: bank?._id ?? '', to: cash?._id ?? '' }));
              setMoving(true);
            }}
          >
            Move money
          </Button>
        )}
      </div>

      {moving && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountPaise || amountPaise <= 0) return;
            record.mutate({ fromAccountId: form.from, toAccountId: form.to, amountPaise, date: form.date, narration: form.narration.trim() || undefined });
          }}
        >
          {(['from', 'to'] as const).map((side) => (
            <label key={side} className="block">
              <span className="mb-1 block text-caption font-medium text-ink-700">{side === 'from' ? 'From' : 'To'}</span>
              <select className={select} value={form[side]} onChange={(e) => setForm({ ...form, [side]: e.target.value })}>
                {(ledgers.data ?? []).map((l) => (
                  <option key={l._id} value={l._id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Amount (₹)</span>
            <input className={`${select} w-32 text-right font-mono`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Date</span>
            <input type="date" className={select} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Note</span>
            <input className={`${select} w-52`} value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} placeholder="optional" />
          </label>
          <Button type="submit" disabled={busy || !amountPaise || amountPaise <= 0 || form.from === form.to}>
            {record.isPending ? 'Posting…' : 'Post transfer'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMoving(false)}>
            Cancel
          </Button>
          {form.from === form.to && <p className="w-full text-caption text-error-fg">Choose two different accounts.</p>}
          {amountPaise === null && <p className="w-full text-caption text-error-fg">The amount isn&apos;t a number in rupees.</p>}
        </form>
      )}

      {list.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-pending-fg">Look like transfers ({list.length})</p>
          {list.map((s) => (
            <div key={s.lineId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2">
              <div className="min-w-0">
                <p className="text-body text-ink-900">
                  {s.kind === 'between_accounts'
                    ? `${s.fromBank} → ${s.toBank}`
                    : s.kind === 'cash_withdrawal'
                      ? `Cash withdrawn from ${s.bank}`
                      : s.kind === 'gateway_settlement'
                        ? `Payment gateway settled into ${s.bank}`
                        : `Cash paid into ${s.bank}`}
                  <span className="ml-2 font-mono">{formatRupees(s.amountPaise)}</span>
                  <span className="ml-2 text-caption text-ink-500">{shortDate(s.date)}</span>
                </p>
                <p className="text-caption text-ink-500">{s.reason}</p>
              </div>
              {s.kind === 'between_accounts' ? (
                <Button size="sm" disabled={busy} onClick={() => pair.mutate({ lineId: s.lineId, otherLineId: s.otherLineId })}>
                  Pair as transfer
                </Button>
              ) : s.kind === 'gateway_settlement' ? (
                <span className="flex items-center gap-2">
                  <input
                    aria-label="Fee the gateway kept (₹)"
                    title="The fee the gateway kept: what it collected for these payments, less this settlement"
                    placeholder="Fee ₹"
                    inputMode="decimal"
                    className="w-24 rounded border border-line-200 bg-white px-2 py-1 text-right font-mono text-caption"
                    value={fees[s.lineId] ?? ''}
                    onChange={(e) => setFees({ ...fees, [s.lineId]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    disabled={busy || !bank || !gateway || parseRupees(fees[s.lineId] ?? '') === null}
                    onClick={() =>
                      record.mutate({
                        fromAccountId: gateway!._id,
                        toAccountId: bank!._id,
                        amountPaise: s.amountPaise,
                        feePaise: parseRupees(fees[s.lineId] ?? '') ?? 0,
                        date: s.date,
                        bankLineId: s.lineId,
                      })
                    }
                  >
                    Post from gateway
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || !bank || !cash}
                  onClick={() =>
                    record.mutate({
                      fromAccountId: s.kind === 'cash_withdrawal' ? bank!._id : cash!._id,
                      toAccountId: s.kind === 'cash_withdrawal' ? cash!._id : bank!._id,
                      amountPaise: s.amountPaise,
                      date: s.date,
                      bankLineId: s.lineId,
                    })
                  }
                >
                  {s.kind === 'cash_withdrawal' ? 'Post to cash in hand' : 'Post from cash in hand'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
