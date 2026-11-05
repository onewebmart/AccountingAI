'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ReportTable, ReportTableView } from '@/components/reports/report-table-view';

/**
 * Ask your books, from any page: a round button at the bottom right that
 * opens a small chat. It asks the same API the old dashboard block did
 * (POST /reports/ask, then GET /reports/ask/:id while the AI works) and only
 * ever reads: answers come from reports, nothing here posts or changes the
 * books.
 *
 * Mounted once in the app layout, so the conversation stays while you move
 * between pages. It is also kept in sessionStorage, per person and business,
 * so a reload does not lose it and another sign-in never sees it.
 *
 * Placement: bottom-6 right-6, lifted to bottom-24 on pages with a form's
 * action bar (FormPage marks it with data-form-bar) so it never sits on the
 * Save buttons. The Notifier's toasts stack above it.
 */

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

interface Turn {
  id: string;
  question: string;
  /** Null while the question is on its way. */
  answer: Answer | null;
  error: string | null;
  showRows: boolean;
}

const SUGGESTED = ['What was my profit last month?', 'Who owes me money?', 'Who are my top customers this year?', 'How much did we spend on rent this year?', 'What is my GST for last month?'];
const MAX_TURNS = 20;
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

function load(key: string): Turn[] {
  try {
    const raw = sessionStorage.getItem(key);
    const turns: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(turns)) return [];
    // A question that was still being sent when the page reloaded has no
    // answer to wait for; say so rather than spin for ever.
    return (turns as Turn[]).map((t) => (!t.answer && !t.error ? { ...t, error: 'This question was interrupted. Ask it again.' } : t));
  } catch {
    return [];
  }
}

function save(key: string, turns: Turn[]) {
  try {
    if (turns.length) sessionStorage.setItem(key, JSON.stringify(turns.slice(-MAX_TURNS)));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the conversation still lives in memory.
  }
}

const reportLink = (a: Answer) =>
  a.report ? `/reports/management?report=${a.report.key}${a.report.from ? `&from=${a.report.from}&to=${a.report.to}` : ''}` : null;

/** Shown to everyone whose role can read reports, the same rule the API applies. */
export function AskAssistant() {
  const { user } = useAuth();
  if (!user || !hasPermission(user.role as UserRole, Permission.VIEW_REPORTS)) return null;
  // Another person or business starts a fresh conversation.
  const scope = `${user.orgId}:${user.userId}`;
  return <Assistant key={scope} storeKey={`aibooks.ask:${scope}`} />;
}

function Assistant({ storeKey }: { storeKey: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => load(storeKey));
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const panelId = useId();
  const inputId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => save(storeKey, turns), [storeKey, turns]);

  const update = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);
  /** An answer arrived: mark the button if the panel is closed. */
  const settled = useCallback(() => {
    if (!openRef.current) setUnread(true);
  }, []);

  // The AI answers in a background job: check back until it has.
  const last = turns[turns.length - 1];
  const pending = last && !last.error && last.answer?.status === 'queued' ? last.answer.id : null;
  const pendingTurn = pending ? last.id : null;
  const poll = useQuery({
    queryKey: ['reports', 'ask', pending],
    queryFn: () => api.get<Answer>(`/reports/ask/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    const done = poll.data;
    if (!done || done.status === 'queued') return;
    setTurns((all) => all.map((t) => (t.answer?.id === done.id && t.answer.status === 'queued' ? { ...t, answer: done } : t)));
    settled();
  }, [poll.data, settled]);
  useEffect(() => {
    if (poll.isError && pendingTurn) {
      update(pendingTurn, { error: message(poll.error) });
      settled();
    }
  }, [poll.isError, poll.error, pendingTurn, update, settled]);

  const busy = sending || !!pending;

  const submit = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns((all) => [...all, { id, question: text, answer: null, error: null, showRows: true }].slice(-MAX_TURNS));
    setQuestion('');
    setSending(true);
    try {
      const a = await api.post<Answer>('/reports/ask', { question: text });
      update(id, { answer: a });
      if (a.status !== 'queued') settled();
    } catch (err) {
      update(id, { error: message(err) });
      settled();
    } finally {
      setSending(false);
    }
  };

  const retry = (turn: Turn) => {
    setTurns((all) => all.filter((t) => t.id !== turn.id));
    void submit(turn.question);
  };

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setUnread(false);
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Bring the newest question to the top of the view, so its answer reads from
  // the start rather than from the bottom of a long table.
  const lastStatus = last ? `${last.id}:${last.answer?.status ?? ''}:${last.error ?? ''}` : '';
  useEffect(() => {
    const el = scrollRef.current;
    const turn = el?.lastElementChild as HTMLElement | null | undefined;
    if (el && turn) el.scrollTop = Math.max(0, turn.offsetTop - 12);
  }, [open, lastStatus]);

  /** Opening a report on a phone hides the page behind the panel; get out of the way. */
  const onNavigate = () => {
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-6 z-40 flex flex-col items-end gap-3 sm:inset-x-auto sm:right-6 [body:has([data-form-bar])_&]:bottom-24">
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label="Ask your books"
          className="pointer-events-auto flex h-[520px] max-h-[calc(100vh-10rem)] w-full animate-fade-in flex-col overflow-hidden rounded-lg border border-line-200 bg-surface-card shadow-e3 sm:w-[380px] [body:has([data-form-bar])_&]:max-h-[calc(100vh-14rem)]"
        >
          <header className="flex items-start gap-3 border-b border-line-200 bg-honey-50 px-4 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-honey-100 text-pending-fg">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-body-lg font-semibold text-ink-900">Ask your books</h2>
              <p className="text-caption text-ink-500">Answers come from your reports. Nothing in your books changes.</p>
            </div>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => setTurns([])}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-honey-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
                aria-label="Start a new conversation"
                title="Start a new conversation"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-honey-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
              aria-label="Close"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </header>

          <div ref={scrollRef} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {turns.length === 0 ? (
              <div className="space-y-4">
                <p className="text-body text-ink-700">
                  Ask about your money in plain words. The answer comes from one of your reports, with the rows it used.
                </p>
                <div>
                  <p className="mb-2 text-label uppercase tracking-[0.04em] text-ink-500">Try one of these</p>
                  <div className="flex flex-col items-start gap-1.5">
                    {SUGGESTED.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void submit(s)}
                        className="rounded-full border border-line-200 bg-surface-card px-3 py-1.5 text-left text-caption text-ink-700 hover:border-marigold-400 hover:bg-honey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              turns.map((t) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  onToggleRows={() => update(t.id, { showRows: !t.showRows })}
                  onRetry={busy ? undefined : () => retry(t)}
                  onNavigate={onNavigate}
                />
              ))
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-line-200 bg-surface-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(question);
            }}
          >
            <label htmlFor={inputId} className="sr-only">Your question</label>
            <input
              id={inputId}
              ref={inputRef}
              className="h-10 min-w-0 flex-1 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              placeholder="Ask a question about your books"
              value={question}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              type="submit"
              aria-label="Ask"
              title="Ask"
              disabled={question.trim().length < 3 || busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-saffron-600 text-white transition-colors hover:bg-saffron-500 active:bg-saffron-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </form>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? 'Close Ask your books' : unread ? 'Ask your books (new answer)' : 'Ask your books'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="group pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-saffron-600 text-white shadow-e3 ring-4 ring-marigold-400/30 transition-colors hover:bg-saffron-500 active:bg-saffron-700 focus-visible:outline-none focus-visible:ring-marigold-400"
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
        {!open && (busy || unread) && (
          <span
            aria-hidden
            className={cn('absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-marigold-400', busy && 'animate-pulse')}
          />
        )}
        {!open && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2.5 py-1 text-caption font-medium text-white opacity-0 shadow-e2 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            Ask your books
          </span>
        )}
      </button>
    </div>
  );
}

/** One question and its answer, with the report rows behind it. */
function TurnView({ turn, onToggleRows, onRetry, onNavigate }: {
  turn: Turn;
  onToggleRows: () => void;
  onRetry?: () => void;
  onNavigate: () => void;
}) {
  const a = turn.answer;
  const link = a ? reportLink(a) : null;
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-ink-900 px-3 py-2 text-body text-white">
        {turn.question}
      </p>
      {turn.error ? (
        <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-error-fg/30 bg-error-bg px-3 py-2 text-body text-error-fg">
          <p>{turn.error}</p>
          {onRetry && (
            <button type="button" className="mt-1 text-caption font-medium underline" onClick={onRetry}>
              Ask again
            </button>
          )}
        </div>
      ) : !a || a.status === 'queued' ? (
        <p className="flex w-fit items-center gap-2 rounded-lg rounded-bl-sm bg-surface-sink px-3 py-2 text-caption text-ink-500">
          <Loader2 size={13} className="animate-spin" /> Finding the report that answers it…
        </p>
      ) : (
        <>
          {a.answer ? (
            <div className={cn('rounded-lg rounded-bl-sm px-3 py-2 text-body', a.source === 'model' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-900')}>
              <p className="whitespace-pre-wrap">{a.answer}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-caption opacity-80">
                {a.source === 'model' && <Sparkles size={12} />}
                {a.reason}
                {link && <> · <Link className="underline" href={link} onClick={onNavigate}>Open the report</Link></>}
                {a.table && <> · <button type="button" className="underline" onClick={onToggleRows}>{turn.showRows ? 'Hide' : 'Show'} the rows</button></>}
              </p>
            </div>
          ) : (
            <p className="rounded-lg rounded-bl-sm bg-surface-sink px-3 py-2 text-body text-ink-600">{a.reason}</p>
          )}
          {a.table && turn.showRows && (
            // The panel is narrow: the report's rows in caption size, scrolling sideways when wide.
            <div className="[&_table]:text-caption [&_td]:align-top">
              <ReportTableView table={a.table} highlight={a.rows} compact />
            </div>
          )}
        </>
      )}
    </div>
  );
}
