'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface Narrative {
  id: string;
  status: 'queued' | 'done' | 'none' | 'failed';
  period: string;
  source: 'rule' | 'model' | null;
  reason: string | null;
  sentences: string[];
  facts: Array<{ id: string; text: string }>;
}

const lastMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
};
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/** The month in a few sentences: figures from the books, worded by AI when there is one, checked either way. */
export function NarrativeCard() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(lastMonth());
  const [showFacts, setShowFacts] = useState(false);
  const latest = useQuery({ queryKey: ['reports', 'narrative', period], queryFn: () => api.get<Narrative | null>(`/reports/narrative?period=${period}`) });
  const write = useMutation({ mutationFn: () => api.post<Narrative>('/reports/narrative', { period }), onSuccess: (n) => qc.setQueryData(['reports', 'narrative', period], n) });
  const pending = latest.data?.status === 'queued' ? latest.data.id : null;
  const poll = useQuery({
    queryKey: ['reports', 'narrative', 'job', pending],
    queryFn: () => api.get<Narrative>(`/reports/narrative/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') qc.setQueryData(['reports', 'narrative', period], poll.data);
  }, [poll.data, period, qc]);

  const n = latest.data;
  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3 font-display text-ink-900">The month in words</h3>
        <div className="flex items-center gap-2">
          <input type="month" className="h-9 rounded-md border border-line-200 bg-white px-2 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={write.isPending || !!pending} onClick={() => write.mutate()}>
            {write.isPending ? 'Writing…' : n ? 'Write it again' : 'Write the summary'}
          </Button>
        </div>
      </div>
      {latest.isLoading && <p className="text-caption text-ink-400">Loading…</p>}
      {write.isError && <p className="text-caption text-error-fg">{message(write.error)}</p>}
      {!latest.isLoading && !n && <p className="text-body text-ink-500">A few sentences on the month: profit and what moved it, who is paying late, cash. Every figure comes from the books.</p>}
      {n && (
        <div className="space-y-2">
          {pending && <p className="flex items-center gap-2 text-caption text-ink-500"><Loader2 size={13} className="animate-spin" /> AI is wording it; the figures below are already the books'.</p>}
          {n.sentences.length ? (
            <div className={`rounded-md p-3 text-body ${n.source === 'model' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-900'}`}>
              <p>{n.sentences.join(' ')}</p>
              <p className="mt-1 flex items-center gap-1 text-caption opacity-80">{n.source === 'model' && <Sparkles size={12} />}{n.reason}</p>
            </div>
          ) : (
            <p className="text-body text-ink-500">{n.reason}</p>
          )}
          {n.facts.length > 0 && (
            <button type="button" className="text-caption text-ink-600 underline" onClick={() => setShowFacts(!showFacts)}>{showFacts ? 'Hide' : 'Show'} the figures behind it</button>
          )}
          {showFacts && <ul className="list-disc space-y-0.5 pl-5 text-caption text-ink-600">{n.facts.map((f) => <li key={f.id}>{f.text}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
