'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { ReportTable, ReportTableView } from './report-table-view';

interface Answer {
  id: string;
  status: 'queued' | 'done' | 'none' | 'failed';
  question: string;
  source: 'rule' | 'model' | null;
  reason: string | null;
  answer: string | null;
  rows: number[];
  table: ReportTable | null;
  report: { key: string; from?: string; to?: string } | null;
}

const SUGGESTED = ['What was my profit last month?', 'Who owes me money?', 'Who are my top customers this year?', 'How much did we spend on rent this year?', 'What is my GST for last month?'];
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/** Ask a question in plain words; the answer comes from a report, with the rows it used. */
export function AskBox() {
  const [question, setQuestion] = useState('');
  const [current, setCurrent] = useState<Answer | null>(null);
  const [showRows, setShowRows] = useState(true);
  const ask = useMutation({ mutationFn: (q: string) => api.post<Answer>('/reports/ask', { question: q }), onSuccess: (a) => { setCurrent(a); setShowRows(true); } });
  // The AI answers in a background job: check back until it has.
  const pending = current?.status === 'queued' ? current.id : null;
  const poll = useQuery({
    queryKey: ['reports', 'ask', pending],
    queryFn: () => api.get<Answer>(`/reports/ask/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') setCurrent(poll.data);
  }, [poll.data]);

  const submit = (q: string) => {
    const text = q.trim();
    if (text.length < 3) return;
    setQuestion(text);
    ask.mutate(text);
  };
  const link = current?.report ? `/reports/management?report=${current.report.key}${current.report.from ? `&from=${current.report.from}&to=${current.report.to}` : ''}` : null;

  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="mb-2 flex items-center gap-2 text-h3 font-display text-ink-900"><MessageSquare size={18} /> Ask your books</h3>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(question); }}>
        <input className="h-10 flex-1 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40" placeholder="Who owes me money?" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" disabled={question.trim().length < 3 || ask.isPending || !!pending}>{ask.isPending || pending ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}</Button>
      </form>
      {!current && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => <button key={s} type="button" className="rounded-full border border-line-200 px-2.5 py-1 text-caption text-ink-600 hover:bg-surface-sink" onClick={() => submit(s)}>{s}</button>)}
        </div>
      )}
      {ask.isError && <p className="mt-2 text-caption text-error-fg">{message(ask.error)}</p>}
      {pending && <p className="mt-3 flex items-center gap-2 text-caption text-ink-500"><Loader2 size={13} className="animate-spin" /> Finding the report that answers it…</p>}
      {current && current.status !== 'queued' && (
        <div className="mt-3 space-y-2">
          {current.answer ? (
            <div className={`rounded-md p-3 text-body ${current.source === 'model' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-900'}`}>
              <p>{current.answer}</p>
              <p className="mt-1 flex items-center gap-1 text-caption opacity-80">
                {current.source === 'model' && <Sparkles size={12} />}
                {current.reason}
                {link && <> · <Link className="underline" href={link}>Open the report</Link></>}
                {current.table && <> · <button type="button" className="underline" onClick={() => setShowRows(!showRows)}>{showRows ? 'Hide' : 'Show'} the rows</button></>}
              </p>
            </div>
          ) : (
            <p className="rounded-md bg-surface-sink p-3 text-body text-ink-600">{current.reason}</p>
          )}
          {current.table && showRows && <ReportTableView table={current.table} highlight={current.rows} compact />}
        </div>
      )}
    </section>
  );
}
