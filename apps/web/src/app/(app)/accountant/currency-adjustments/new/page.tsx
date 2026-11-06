'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { Notice, errorText, shortDate, todayIso } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Currency { code: string; name: string; digits: number }
interface Row {
  kind: 'invoice' | 'bill'; id: string; number: string | null; date: string; party: string; currency: string; digits: number;
  openMinor: number; bookedRate: number; rate: number; bookedPaise: number; revaluedPaise: number; differencePaise: number; gainPaise: number;
}
interface Preview {
  currency: string; digits: number; date: string; rate: number; period: string; reverseOn: string;
  rows: Row[]; receivablesPaise: number; payablesPaise: number; gainPaise: number; blocked: string | null;
}

const fmtMinor = (minor: number, code: string, digits: number) =>
  `${code} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const RATE = /^\d{1,6}(\.\d{1,4})?$/;

function Gain({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-ink-500">Nil</span>;
  return <span className={paise > 0 ? 'text-success-fg' : 'text-error-fg'}>{paise > 0 ? 'Gain' : 'Loss'} {formatPaise(Math.abs(paise))}</span>;
}

/**
 * A base currency adjustment: the currency, the date and the rate, then
 * Continue shows every open invoice and bill in that currency at the new
 * rate against what it is booked at. Propose adjustment sends the gain or
 * loss to the review queue; it posts when someone approves it there.
 */
export default function NewCurrencyAdjustmentPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies') }).data ?? [];
  const [f, setF] = useState({ currency: '', date: todayIso(), rate: '', notes: '' });
  const [rateTouched, setRateTouched] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest saved rate on or before the date, as a start; the person types the day's rate.
  const known = useQuery({
    queryKey: ['currency', 'rate-on', f.currency, f.date],
    enabled: !!f.currency && /^\d{4}-\d{2}-\d{2}$/.test(f.date),
    queryFn: () => api.get<{ rate: number; date: string } | null>(`/currency/rates/on?currency=${f.currency}&date=${f.date}`),
  });
  useEffect(() => {
    if (!rateTouched && known.data) setF((x) => ({ ...x, rate: String(known.data!.rate) }));
  }, [known.data, rateTouched]);

  const go = useMutation({
    mutationFn: () => api.get<Preview>(`/currency/adjustments/preview?currency=${f.currency}&date=${f.date}&rate=${encodeURIComponent(f.rate)}`),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(errorText(err, "Couldn't read the open documents.")),
  });
  const propose = useMutation({
    mutationFn: () => api.post<{ proposalId: string }>('/currency/adjustments', { currency: f.currency, date: f.date, rate: Number(f.rate), notes: f.notes.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['currency'] });
      void qc.invalidateQueries({ queryKey: ['workspace'] });
      notify('Sent to the review queue');
      router.push('/accountant/currency-adjustments');
    },
    onError: (err) => setError(errorText(err, "Couldn't propose the adjustment.")),
  });

  const proceed = () => {
    if (!f.currency) return setError('Choose the currency.');
    if (!f.date) return setError('Enter the date of the adjustment.');
    if (f.date > todayIso()) return setError('Date the adjustment today or earlier.');
    if (!RATE.test(f.rate.trim()) || !(Number(f.rate) > 0)) return setError('Enter the rate as rupees for one unit, with up to four decimals, like 25.58.');
    if (!f.notes.trim()) return setError('Add a note: why the rate is being adjusted, or where it comes from.');
    setError(null);
    if (!preview) go.mutate();
    else propose.mutate();
  };
  const edit = (patch: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...patch }));
    setPreview(null);
  };

  const p = preview;
  const unit = f.currency || '1 unit';
  const nothing = !!p && (p.rows.length === 0 || (p.receivablesPaise === 0 && p.payablesPaise === 0));

  return (
    <FormPage
      onSubmit={proceed}
      error={error}
      actions={
        p ? (
          <>
            <Button type="submit" disabled={propose.isPending || !!p.blocked || nothing}>{propose.isPending ? 'Proposing…' : 'Propose adjustment'}</Button>
            <Button type="button" variant="secondary" onClick={() => setPreview(null)}><ArrowLeft size={14} /> Change the details</Button>
            <Link href="/accountant/currency-adjustments"><Button type="button" variant="ghost">Cancel</Button></Link>
          </>
        ) : (
          <>
            <Button type="submit" disabled={go.isPending}>{go.isPending ? 'Reading…' : 'Continue'}</Button>
            <Link href="/accountant/currency-adjustments"><Button type="button" variant="secondary">Cancel</Button></Link>
          </>
        )
      }
    >
      <PageHeader
        title="New currency adjustment"
        subtitle="Revalue what is still open in one currency at a new rate. Nothing posts here: the gain or loss waits in the review queue for someone to approve."
        back={{ href: '/accountant/currency-adjustments', label: 'Currency adjustments' }}
      />

      <Section title="The rate">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Currency" required>
            <select className={inputClass} value={f.currency} onChange={(e) => { setRateTouched(false); edit({ currency: e.target.value, rate: '' }); }} disabled={!!p}>
              <option value="">Choose a currency…</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Date of adjustment" required>
            <input type="date" className={inputClass} value={f.date} max={todayIso()} onChange={(e) => edit({ date: e.target.value })} disabled={!!p} />
          </Field>
          <Field
            label="Exchange rate"
            required
            hint={known.data ? `Saved rate on or before that day: ${known.data.rate} (${shortDate(known.data.date)}).` : 'Saved as that day’s rate when you propose.'}
          >
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-body text-ink-600">1 {unit} =</span>
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => { setRateTouched(true); edit({ rate: e.target.value }); }} placeholder="25.58" disabled={!!p} aria-label="Rupees for one unit" />
              <span className="text-body text-ink-600">INR</span>
            </div>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes" required hint="Shown to the reviewer and kept with the entry.">
            <textarea className={`${inputClass} min-h-[72px]`} maxLength={300} value={f.notes} onChange={(e) => edit({ notes: e.target.value })} placeholder="RBI reference rate at the quarter's end" disabled={!!p} />
          </Field>
        </div>
      </Section>

      {p && (
        <Section
          title={`Open ${p.currency} invoices and bills on ${shortDate(p.date)}`}
          description={`At 1 ${p.currency} = ₹${p.rate}, against the rupees each is booked at. Unrealised: the entry reverses itself on ${shortDate(p.reverseOn)}, and the real gain or loss posts when each is paid.`}
        >
          {p.blocked && <div className="mb-3"><Notice tone="error">{p.blocked}</Notice></div>}
          {p.rows.length === 0 ? (
            <p className="text-body text-ink-500">Nothing is open in {p.currency} on {shortDate(p.date)}: there is nothing to adjust.</p>
          ) : (
            <TableCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className={th}>Document</th>
                    <th className={th}>Party</th>
                    <th className={`${th} text-right`}>Still open</th>
                    <th className={`${th} text-right`}>Booked at</th>
                    <th className={`${th} text-right`}>Booked ₹</th>
                    <th className={`${th} text-right`}>At {p.rate}</th>
                    <th className={`${th} text-right`}>Gain or loss</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.id} className="border-b border-line-100 last:border-0">
                      <td className={td}>
                        <Link href={r.kind === 'invoice' ? `/sales/invoices/${r.id}` : `/purchases/bills/${r.id}`} className="hover:underline">
                          {r.kind === 'invoice' ? 'Invoice' : 'Bill'} <span className="font-mono">{r.number ?? '(no number)'}</span>
                        </Link>
                        <p className="text-caption text-ink-500">{shortDate(r.date)}</p>
                      </td>
                      <td className={`${td} max-w-[200px] truncate`}>{r.party || '—'}</td>
                      <td className={tdMoney}>{fmtMinor(r.openMinor, r.currency, r.digits)}</td>
                      <td className={tdMoney}>{r.bookedRate}</td>
                      <td className={tdMoney}>{formatPaise(r.bookedPaise)}</td>
                      <td className={tdMoney}>{formatPaise(r.revaluedPaise)}</td>
                      <td className={tdMoney}><Gain paise={r.gainPaise} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-200 bg-surface-sink">
                    <td className={`${td} font-medium`} colSpan={6}>Unrealised {p.gainPaise >= 0 ? 'gain' : 'loss'}</td>
                    <td className={`${tdMoney} font-medium`}><Gain paise={p.gainPaise} /></td>
                  </tr>
                </tfoot>
              </table>
            </TableCard>
          )}
          {p.rows.length > 0 && (
            <dl className="mt-3 grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-body">
              <dt className="text-ink-500">Receivables move by</dt><dd className="text-right font-mono">{formatPaise(p.receivablesPaise)}</dd>
              <dt className="text-ink-500">Payables move by</dt><dd className="text-right font-mono">{formatPaise(p.payablesPaise)}</dd>
              <dt className="text-ink-500">Posts to</dt>
              <dd className="text-right">
                {[
                  (p.receivablesPaise > 0 || p.payablesPaise < 0) && 'Foreign Exchange Gain',
                  (p.receivablesPaise < 0 || p.payablesPaise > 0) && 'Foreign Exchange Loss',
                ].filter(Boolean).join(' and ')}
              </dd>
            </dl>
          )}
          <p className="mt-3 text-caption text-ink-500">Bank accounts are kept in rupees, so no bank balance is revalued. The rate is saved as the {p.currency} rate for {shortDate(p.date)}.</p>
          {nothing && p.rows.length > 0 && <p className="mt-2 text-caption text-ink-500">The open documents are worth the same at this rate: there is nothing to adjust.</p>}
        </Section>
      )}
    </FormPage>
  );
}
