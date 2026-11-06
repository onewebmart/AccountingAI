'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, X } from 'lucide-react';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { useTimer } from './types';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Your running timer, from the server, so it is the same after a reload or
 * on another page. Amber while it runs: time not yet logged. Stopping it logs
 * the minutes as a time entry.
 */
export function TimerChip() {
  const qc = useQueryClient();
  const timer = useTimer();
  const [now, setNow] = useState(() => Date.now());
  const running = timer.data;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });
  const stop = useMutation({
    mutationFn: () => api.post('/projects/time/timer/stop', {}),
    onSuccess: () => {
      refresh();
      notify('Time logged from the timer');
    },
    onError: (err) => {
      refresh();
      notify(errorText(err, "Couldn't stop the timer."), 'error');
    },
  });
  const discard = useMutation({
    mutationFn: () => api.delete('/projects/time/timer'),
    onSuccess: () => {
      refresh();
      notify('Timer discarded', 'info');
    },
    onError: (err) => notify(errorText(err, "Couldn't discard the timer."), 'error'),
  });

  if (!running) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-pending-fg/30 bg-pending-bg py-1 pl-3 pr-1 text-caption text-pending-fg" role="timer" aria-label={`Timer running on ${running.projectName}`}>
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-marigold-300 opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-marigold-400" />
      </span>
      <span className="font-mono tabular-nums text-ink-900">{clock(now - Date.parse(running.startedAt))}</span>
      <Link href={`/time/projects/${running.projectId}`} className="max-w-[220px] truncate hover:underline" title={`${running.projectName} · ${running.task}`}>
        {running.projectName} · {running.task}
      </Link>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending || discard.isPending}
        className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        <Square size={10} fill="currentColor" aria-hidden /> {stop.isPending ? 'Stopping…' : 'Stop timer'}
      </button>
      <button
        type="button"
        onClick={() => discard.mutate()}
        disabled={stop.isPending || discard.isPending}
        className="grid h-6 w-6 place-items-center rounded-full text-pending-fg hover:bg-white/60 disabled:opacity-50"
        aria-label="Discard the timer"
        title="Discard the timer without logging it"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}
