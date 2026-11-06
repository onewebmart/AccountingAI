'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Bot, Send, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KPI, MONTHS, TRANSACTIONS } from './sample-data';
import { SampleChip, rupees } from './shared';

const EASE = [0.22, 1, 0.36, 1] as const;

const sep = MONTHS[MONTHS.length - 2];
const overdue = TRANSACTIONS.find((t) => t.status === 'Overdue');

const THREAD: Array<{ from: 'you' | 'books'; text: string }> = [
  { from: 'you', text: 'How did revenue in October compare with September?' },
  {
    from: 'books',
    text: `October revenue was ${rupees(KPI.revenue)}, up ${KPI.revenueChange}% on September (${rupees(sep.revenue)}). The largest invoice was INV-0142 to Mehta Textiles Pvt Ltd for ${rupees(1_18_000_00)}.`,
  },
  { from: 'you', text: 'Which invoices are overdue?' },
  {
    from: 'books',
    text: overdue
      ? `One: ${overdue.number} to ${overdue.party} for ${rupees(overdue.amount)}, issued ${overdue.date}.`
      : 'None right now.',
  },
];

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 px-1 py-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink-400"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

/**
 * "Ask your books": a short thread that plays once when it scrolls into
 * view, the answer arriving after a moment of typing. Under reduced motion the
 * whole thread is simply there.
 */
export function AskBooks() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  // How many messages are showing, and whether the next answer is being typed.
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduce) {
      setShown(THREAD.length);
      return;
    }
    if (!inView || shown >= THREAD.length) return;
    const next = THREAD[shown];
    if (next.from === 'books' && !typing) {
      const t = window.setTimeout(() => setTyping(true), 300);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(
      () => {
        setTyping(false);
        setShown((n) => n + 1);
      },
      next.from === 'books' ? 1100 : shown === 0 ? 300 : 900,
    );
    return () => window.clearTimeout(t);
  }, [inView, reduce, shown, typing]);

  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div>
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-brand-700">Ask your books</p>
        <h3 className="mt-3 font-heading text-h1 text-navy-900">Ask a question. Get the answer from your own books.</h3>
        <p className="mt-3 text-body-lg text-ink-600">
          Type a question in plain words, like you would ask your accountant. The assistant answers
          from your own ledger, invoices and bills.
        </p>

        <div className="mt-8 flex gap-4 rounded-2xl border border-brand-100 bg-surface-card p-5 shadow-e1">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <TrendingUp size={20} aria-hidden />
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.1em] text-brand-700">
              <Sparkles size={12} aria-hidden /> AI insight
            </p>
            <p className="mt-1 text-body text-ink-700">
              Your business revenue is trending upward. Review your latest financial performance to
              identify growth opportunities.
            </p>
          </div>
        </div>
      </div>

      <div ref={ref} className="rounded-2xl border border-line-200 bg-surface-card shadow-e2">
        <div className="flex items-center justify-between gap-3 border-b border-line-100 px-5 py-4">
          <p className="flex items-center gap-2 text-label font-semibold text-navy-900">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900 text-brand-400">
              <Bot size={18} aria-hidden />
            </span>
            Ask your books
          </p>
          <SampleChip />
        </div>

        {/* Live region: a screen reader hears each message as it arrives. */}
        <div className="min-h-[340px] space-y-3 px-5 py-5" aria-live="polite">
          <AnimatePresence initial={false}>
            {THREAD.slice(0, shown).map((m) => (
              <motion.div
                key={m.text}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className={cn('flex', m.from === 'you' ? 'justify-end' : 'justify-start')}
              >
                <p
                  className={cn(
                    'max-w-[88%] rounded-2xl px-4 py-2.5 text-body',
                    m.from === 'you'
                      ? 'rounded-br-md bg-navy-900 text-white'
                      : 'rounded-bl-md bg-surface-sink text-ink-900',
                  )}
                >
                  <span className="sr-only">{m.from === 'you' ? 'You asked: ' : 'Answer: '}</span>
                  {m.text}
                </p>
              </motion.div>
            ))}
            {typing && (
              <motion.div
                key="typing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex"
              >
                <span className="rounded-2xl rounded-bl-md bg-surface-sink px-3 py-2">
                  <Typing />
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-line-100 p-3" aria-hidden>
          <div className="flex items-center gap-2 rounded-xl border border-line-200 bg-surface-page px-3 py-2">
            <span className="flex-1 truncate text-body text-ink-400">Ask about revenue, expenses, GST…</span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Send size={15} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
