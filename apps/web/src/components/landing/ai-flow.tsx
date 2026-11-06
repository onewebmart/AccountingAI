'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Check, CircleCheck, CloudUpload, FileText, ScanText, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rupees } from './shared';

const EASE = [0.22, 1, 0.36, 1] as const;
const STEP_MS = 2800;

const STEPS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: CloudUpload,
    title: 'Upload a bill or receipt',
    body: 'Drop in a PDF or a photo, or email it in. Invoices and receipts work the same way.',
  },
  {
    icon: ScanText,
    title: 'AI reads it',
    body: 'Vendor, GSTIN, date, line items and tax are read off the page. If a read fails, it tells you why.',
  },
  {
    icon: Sparkles,
    title: 'It proposes the entry',
    body: 'A balanced journal entry, with the GST split out, waits for review, clearly marked as proposed.',
  },
  {
    icon: CircleCheck,
    title: 'You approve, it posts',
    body: 'Approve and it posts to the ledger with the next voucher number. Until then, your books are untouched.',
  },
];

/** What the AI read off the sample bill. */
const FIELDS: Array<[string, string]> = [
  ['Vendor', 'Sharma Office Supplies'],
  ['GSTIN', '24ABCDE1234F1Z5'],
  ['Invoice no.', 'SOS/1187'],
  ['Date', '30 Oct'],
  ['Taxable value', rupees(16_000_00)],
  ['CGST 9% + SGST 9%', rupees(2_880_00)],
  ['Total', rupees(18_880_00)],
];

const JOURNAL: Array<{ account: string; dr?: number; cr?: number }> = [
  { account: 'Office supplies', dr: 16_000_00 },
  { account: 'Input CGST 9%', dr: 1_440_00 },
  { account: 'Input SGST 9%', dr: 1_440_00 },
  { account: 'Sharma Office Supplies', cr: 18_880_00 },
];

const DESCRIBE = [
  'A bill from Sharma Office Supplies being uploaded.',
  'The AI reading the bill: vendor, GSTIN, invoice number, date, taxable value, GST and total.',
  'A journal entry proposed by the AI, waiting for approval: office supplies and input GST debited, the vendor credited, ₹18,880 on each side.',
  'The same entry after a person approved it: posted to the ledger with voucher number JV-0142.',
];

/** The bill itself, as a sheet of paper. A scan line passes over it while it is read. */
function Bill({ step, reduce }: { step: number; reduce: boolean }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-line-200 bg-surface-card p-4 shadow-e1 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">Tax invoice</p>
          <p className="mt-1 font-heading text-body font-bold text-navy-900">Sharma Office Supplies</p>
          <p className="font-mono text-[11px] text-ink-500">GSTIN 24ABCDE1234F1Z5</p>
        </div>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sink text-ink-500">
          <FileText size={18} aria-hidden />
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-100 pt-3 text-[11px]">
        <div>
          <dt className="text-ink-500">Invoice no.</dt>
          <dd className="font-mono text-caption text-ink-900">SOS/1187</dd>
        </div>
        <div>
          <dt className="text-ink-500">Date</dt>
          <dd className="font-mono text-caption text-ink-900">30 Oct</dd>
        </div>
      </dl>
      <div className="mt-4 space-y-2 border-t border-line-100 pt-3 text-caption">
        <div className="flex justify-between text-ink-600">
          <span>A4 paper, 40 reams</span>
          <span className="font-mono text-ink-900">{rupees(11_200_00)}</span>
        </div>
        <div className="flex justify-between text-ink-600">
          <span>Toner cartridges, 4</span>
          <span className="font-mono text-ink-900">{rupees(4_800_00)}</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-line-200 pt-2 text-ink-600">
          <span>Taxable value</span>
          <span className="font-mono text-ink-900">{rupees(16_000_00)}</span>
        </div>
        <div className="flex justify-between text-ink-600">
          <span>CGST 9% + SGST 9%</span>
          <span className="font-mono text-ink-900">{rupees(2_880_00)}</span>
        </div>
        <div className="flex justify-between border-t border-line-100 pt-2 font-semibold text-navy-900">
          <span>Total</span>
          <span className="font-mono">{rupees(18_880_00)}</span>
        </div>
      </div>

      {/* Upload progress, under the sheet, while it arrives. */}
      <div className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-ink-500">
        <span className="font-mono">bill-sharma.pdf</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sink">
          <motion.span
            key={step === 0 ? 'uploading' : 'done'}
            className="absolute inset-y-0 left-0 rounded-full bg-brand-600"
            initial={step === 0 ? { width: '0%' } : false}
            animate={{ width: '100%' }}
            transition={reduce ? { duration: 0 } : { duration: 1.6, ease: EASE }}
          />
        </span>
        <span>{step === 0 ? 'Uploading' : 'Uploaded'}</span>
      </div>

      {step === 1 && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-brand-400/25 to-transparent"
          initial={{ top: '-15%' }}
          animate={{ top: '100%' }}
          transition={{ duration: 1.4, repeat: 1, ease: 'linear' }}
        />
      )}
    </div>
  );
}

/** What the AI produces: first the fields it read, then the entry it proposes. */
function Output({ step }: { step: number }) {
  const posted = step === 3;

  if (step === 0) {
    return (
      <div className="flex h-full min-h-[340px] lg:min-h-[400px] flex-col justify-center rounded-xl border border-dashed border-brand-200 bg-surface-card/60 p-5 text-center">
        <p className="text-label font-semibold text-navy-900">Waiting for a document</p>
        <p className="mt-1 text-caption text-ink-500">The AI starts reading as soon as the upload finishes.</p>
        <div className="mx-auto mt-5 w-full max-w-[240px] space-y-2" aria-hidden>
          {[80, 64, 72].map((w) => (
            <span key={w} className="block h-2 rounded-full bg-line-200" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="h-full min-h-[340px] lg:min-h-[400px] rounded-xl border border-line-200 bg-surface-card p-5 shadow-e1">
        <p className="flex items-center gap-2 text-label font-semibold text-navy-900">
          <ScanText size={16} className="text-brand-700" aria-hidden />
          Read from the bill
        </p>
        <dl className="mt-4 space-y-2.5 text-caption">
          {FIELDS.map(([k, v], i) => (
            <motion.div
              key={k}
              className="flex justify-between gap-4 border-b border-line-100 pb-2 last:border-0"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.15 + i * 0.22, ease: EASE }}
            >
              <dt className="text-ink-500">{k}</dt>
              <dd className="text-right font-medium text-ink-900">{v}</dd>
            </motion.div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-full min-h-[340px] lg:min-h-[400px] rounded-xl border-l-[3px] bg-surface-card p-5 shadow-e2 ring-1 ring-line-200 transition-[border-color] duration-500',
        posted ? 'border-l-success-fg' : 'border-l-marigold-400',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={posted ? 'posted' : 'proposed'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-semibold',
              posted ? 'bg-success-bg text-success-fg' : 'bg-pending-bg text-pending-fg',
            )}
          >
            {posted ? <Check size={12} strokeWidth={3} /> : <Sparkles size={12} />}
            {posted ? 'Posted to ledger' : 'Proposed by AI'}
          </motion.span>
        </AnimatePresence>
        <span className="font-mono text-caption text-ink-500">{posted ? 'JV-0142' : 'Not yet posted'}</span>
      </div>

      <p className="mt-3 text-label font-semibold text-navy-900">Purchase of office supplies</p>
      <p className="text-caption text-ink-500">Bill SOS/1187 · 30 Oct</p>

      <table className="mt-4 w-full text-caption">
        <thead>
          <tr className="border-b border-line-200 text-left text-ink-500">
            <th scope="col" className="pb-2 font-medium">Account</th>
            <th scope="col" className="pb-2 pl-3 text-right font-medium">Debit</th>
            <th scope="col" className="pb-2 pl-3 text-right font-medium">Credit</th>
          </tr>
        </thead>
        <tbody>
          {JOURNAL.map((l) => (
            <tr key={l.account} className="border-b border-line-100">
              <td className={cn('py-2 text-ink-700', l.cr && 'pl-4')}>{l.account}</td>
              <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-ink-900">{l.dr ? rupees(l.dr) : ''}</td>
              <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-ink-900">{l.cr ? rupees(l.cr) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-navy-900">
            <td className="pt-2">Total</td>
            <td className="whitespace-nowrap pt-2 pl-3 text-right font-mono">{rupees(18_880_00)}</td>
            <td className="whitespace-nowrap pt-2 pl-3 text-right font-mono">{rupees(18_880_00)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-5 flex min-h-[36px] flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-caption font-medium text-success-fg">
          <Check size={14} aria-hidden /> Balanced
        </span>
        {posted ? (
          <span className="text-caption text-ink-500">Approved by a person</span>
        ) : (
          <span className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-caption font-semibold text-white shadow-e1">
            Approve &amp; post
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The four steps from paper to ledger. While in view the steps advance on
 * their own; choosing one stops the cycle there. Under reduced motion nothing
 * advances: it opens on the proposed entry and changes only when asked.
 */
export function AiFlow() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-120px' });
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const auto = !reduce && !held && inView;

  useEffect(() => {
    if (reduce) setStep(2);
  }, [reduce]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), step === 3 ? STEP_MS + 800 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [auto, step]);

  return (
    <div ref={ref} className="grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
      <ol className="space-y-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={title}>
              <button
                type="button"
                onClick={() => {
                  setStep(i);
                  setHeld(true);
                }}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'relative flex w-full gap-4 overflow-hidden rounded-2xl border p-4 text-left transition-[background-color,border-color,box-shadow] duration-300 sm:p-5',
                  active
                    ? 'border-brand-200 bg-surface-card shadow-e2'
                    : 'border-transparent hover:border-brand-200/70 hover:bg-surface-card/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300',
                    active ? 'bg-brand-600 text-white' : done ? 'bg-brand-100 text-brand-700' : 'bg-surface-card text-ink-500 ring-1 ring-inset ring-line-200',
                  )}
                >
                  {done ? <Check size={18} strokeWidth={2.5} aria-hidden /> : <Icon size={20} aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="text-caption font-semibold text-ink-500">Step {i + 1}</span>
                  <span className={cn('block font-heading text-body-lg font-bold', active || done ? 'text-navy-900' : 'text-ink-600')}>
                    {title}
                  </span>
                  <span className={cn('mt-1 block text-body', active ? 'text-ink-600' : 'text-ink-500')}>{body}</span>
                </span>
                {active && auto && (
                  <motion.span
                    aria-hidden
                    key={`progress-${step}`}
                    className="absolute bottom-0 left-0 h-0.5 bg-brand-600"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: (step === 3 ? STEP_MS + 800 : STEP_MS) / 1000, ease: 'linear' }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div
        role="img"
        aria-label={`Illustration, step ${step + 1} of 4: ${DESCRIBE[step]}`}
        className="order-first grid gap-4 rounded-2xl border border-brand-100 bg-brand-100/40 p-3 sm:grid-cols-[0.9fr_1.1fr] sm:p-4 lg:order-none"
      >
        <Bill step={step} reduce={reduce} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step < 2 ? `s${step}` : 'journal'}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0.1 : 0.3, ease: EASE }}
            className="h-full"
          >
            <Output step={step} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
