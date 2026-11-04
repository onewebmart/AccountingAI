'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

type Kind = 'GSTR1' | 'GSTR3B';

interface Filing {
  status: 'saved' | 'otp_sent' | 'filed';
  arn: string | null;
  savedAt: string;
  filedAt: string | null;
  isTest: boolean;
  paymentJournalId: string | null;
}

interface Status {
  provider: { name: string; isMock: boolean; testOtp: string | null };
  GSTR1: Filing | null;
  GSTR3B: Filing | null;
}

const LABEL: Record<Kind, string> = { GSTR1: 'GSTR-1', GSTR3B: 'GSTR-3B' };
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/**
 * Filing a return through the GSP: look over the review, save it to the
 * portal, get the OTP, file. Filing is final; the button says so before it
 * does it. GSTR-3B then records the payment as one voucher.
 */
export function FilingCard({ kind, period, onToast }: { kind: Kind; period: string; onToast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [otp, setOtp] = useState('');
  const [checked, setChecked] = useState(false);
  const [challan, setChallan] = useState('');
  const status = useQuery({ queryKey: ['gst', 'filings', period], queryFn: () => api.get<Status>(`/gst/filings?period=${period}`) });
  const review = useQuery({
    queryKey: ['gst', 'filings', period, kind, 'review'],
    queryFn: () => api.get<Array<{ level: 'look' | 'note'; message: string }>>(`/gst/filings/${kind}/${period}/review`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['gst', 'filings', period] });
  const save = useMutation({ mutationFn: () => api.post(`/gst/filings/${kind}/${period}/save`), onSuccess: () => { refresh(); setChecked(false); onToast(`${LABEL[kind]} saved to the portal`); } });
  const sendOtp = useMutation({ mutationFn: () => api.post(`/gst/filings/${kind}/${period}/otp`), onSuccess: () => { refresh(); onToast('OTP sent'); } });
  const file = useMutation({ mutationFn: () => api.post(`/gst/filings/${kind}/${period}/file`, { otp }), onSuccess: () => { refresh(); setOtp(''); onToast(`${LABEL[kind]} filed`); } });
  const pay = useMutation({
    mutationFn: () => api.post(`/gst/filings/GSTR3B/${period}/payment`, challan.trim() ? { challanNo: challan.trim() } : {}),
    onSuccess: () => { refresh(); onToast('GST payment posted to ledger'); },
  });

  const s = status.data;
  const f = s?.[kind] ?? null;
  const flags = review.data ?? [];
  const error = save.error ?? sendOtp.error ?? file.error ?? pay.error;

  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-display text-ink-900">File {LABEL[kind]}</h3>
        {s?.provider.isMock && <p className="text-caption text-ink-400">Test gateway: nothing reaches the GST portal. The OTP is {s.provider.testOtp}.</p>}
      </div>

      {flags.length > 0 && f?.status !== 'filed' && (
        <ul className="mb-3 space-y-1">
          {flags.map((x, i) => (
            <li key={i} className={`rounded-md p-2 text-caption ${x.level === 'look' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-600'}`}>{x.message}</li>
          ))}
        </ul>
      )}

      {f?.status === 'filed' ? (
        <div className="rounded-md bg-success-bg p-3 text-caption text-success-fg">
          <p className="font-medium">Filed{f.isTest ? ' (test)' : ''} · ARN <span className="font-mono">{f.arn}</span></p>
          {f.filedAt && <p>{new Date(f.filedAt).toLocaleString('en-IN')}</p>}
        </div>
      ) : (
        <ol className="space-y-2 text-caption">
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-4 font-mono text-ink-400">1</span>
            <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : f ? 'Save again' : 'Save to GST portal'}
            </Button>
            {f && <span className="text-ink-500">Saved {new Date(f.savedAt).toLocaleString('en-IN')}</span>}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-4 font-mono text-ink-400">2</span>
            <Button size="sm" variant="secondary" disabled={!f || sendOtp.isPending} onClick={() => sendOtp.mutate()}>
              {sendOtp.isPending ? 'Sending…' : 'Send OTP'}
            </Button>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-4 font-mono text-ink-400">3</span>
            <input
              className="h-9 w-28 rounded-md border border-line-200 px-2 font-mono text-body"
              inputMode="numeric"
              maxLength={6}
              placeholder="OTP"
              value={otp}
              disabled={f?.status !== 'otp_sent'}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
            <label className="flex items-center gap-1 text-ink-600">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={f?.status !== 'otp_sent'} />
              I have checked the return. Filing cannot be undone.
            </label>
            <Button size="sm" disabled={f?.status !== 'otp_sent' || otp.length !== 6 || !checked || file.isPending} onClick={() => file.mutate()}>
              {file.isPending ? 'Filing…' : `File ${LABEL[kind]}`}
            </Button>
          </li>
        </ol>
      )}

      {kind === 'GSTR3B' && f && (
        <div className="mt-3 border-t border-line-100 pt-3 text-caption">
          {f.paymentJournalId ? (
            <p className="text-success-fg">GST for the month is posted to the ledger.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-9 w-40 rounded-md border border-line-200 px-2 font-mono" placeholder="Challan CPIN (optional)" value={challan} onChange={(e) => setChallan(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={pay.isPending} onClick={() => window.confirm('Post the GST set-off and cash payment for this month as one voucher?') && pay.mutate()}>
                {pay.isPending ? 'Posting…' : 'Record GST payment'}
              </Button>
              <span className="text-ink-500">From the 3B as saved: output tax against credit used, and the cash paid.</span>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-caption text-error-fg">{message(error)}</p>}
    </section>
  );
}
