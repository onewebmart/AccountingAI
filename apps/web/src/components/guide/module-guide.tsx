'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BookOpen, Check, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { loadGuide, peekGuide, type GuideKey } from './guides';
import { isBranch, t, type Bi, type Flow, type FlowBranch, type FlowStep, type Guide, type GuideLang, type Tone } from './types';

/**
 * "How it works" for every section: a life-cycle chart drawn in HTML, what you
 * can do there, and the clicks in order, in English or Hindi. It opens from the
 * page header in a panel on the right, and shows inline under an empty list so
 * a new user meets it without looking for it.
 */

// ── Language: remembered between visits, shared by every guide on the page ──

const LANG_KEY = 'aibooks.guide.lang';
const listeners = new Set<() => void>();
let currentLang: GuideLang | null = null;

function readLang(): GuideLang {
  if (currentLang) return currentLang;
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANG_KEY);
  } catch {
    // Storage may be blocked; the guide then opens in English each time.
  }
  currentLang = saved === 'hi' ? 'hi' : 'en';
  return currentLang;
}

function writeLang(lang: GuideLang) {
  currentLang = lang;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembered, but still switched for this visit.
  }
  listeners.forEach((fn) => fn());
}

function subscribeLang(fn: () => void) {
  listeners.add(fn);
  // A choice made in another tab applies here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LANG_KEY) {
      currentLang = null;
      fn();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** The guide language, English until the person picks Hindi. */
export function useGuideLang(): [GuideLang, (lang: GuideLang) => void] {
  const lang = useSyncExternalStore(subscribeLang, readLang, () => 'en' as GuideLang);
  return [lang, writeLang];
}

/** The words around the content, in both languages. */
const UI = {
  howItWorks: t('How it works', 'यह कैसे काम करता है'),
  youCan: t('In this section you can:', 'इस सेक्शन में आप:'),
  steps: t('Step by step', 'स्टेप बाय स्टेप'),
  close: t('Close', 'बंद करें'),
  language: t('Guide language', 'गाइड की भाषा'),
  loading: t('Loading the guide…', 'गाइड खुल रही है…'),
  failed: t('The guide did not load.', 'गाइड नहीं खुल पाई।'),
  retry: t('Try again', 'फिर से कोशिश करें'),
};

/** Devanagari is not in the brand faces; these system fonts carry it cleanly. */
const HINDI_FONT = "var(--font-body), 'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif";

// ── Loading the content ──

function useGuide(key: GuideKey) {
  const [guide, setGuide] = useState<Guide | undefined>(() => peekGuide(key));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const hit = peekGuide(key);
    if (hit) {
      setGuide(hit);
      return;
    }
    let live = true;
    setGuide(undefined);
    setFailed(false);
    loadGuide(key)
      .then((g) => live && setGuide(g))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [key, attempt]);
  return { guide, failed, retry: () => setAttempt((n) => n + 1) };
}

// ── Text: `**Button name**` is bold ──

function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-ink-900">
            {p}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

// ── The chart ──

/** Connectors are info blue: the guide explains, it is not a status. */
const LINE = 'rgba(59, 91, 192, 0.55)';
const vDash = `repeating-linear-gradient(to bottom, ${LINE} 0 4px, transparent 4px 7px)`;
const hDash = `repeating-linear-gradient(to right, ${LINE} 0 4px, transparent 4px 7px)`;

const TONE: Record<Tone, { icon: string; accent?: string }> = {
  action: { icon: 'bg-brand-50 text-saffron-600' },
  ai: { icon: 'bg-honey-100 text-pending-fg', accent: 'marigold' },
  wait: { icon: 'bg-honey-100 text-pending-fg', accent: 'marigold' },
  done: { icon: 'bg-success-bg text-success-fg', accent: 'success' },
  neutral: { icon: 'bg-surface-sink text-ink-500' },
  error: { icon: 'bg-error-bg text-error-fg', accent: 'error' },
};

/** The accent edge of a box, on the left when it is wide and on top when narrow. */
function accentClass(tone: Tone, compact: boolean): string {
  const accent = TONE[tone].accent;
  if (!accent) return 'border-line-200';
  const side = compact ? 'border-t-[3px]' : 'border-l-[3px]';
  return {
    marigold: cn('border-marigold-400/50', side, compact ? 'border-t-marigold-400' : 'border-l-marigold-400'),
    success: cn('border-success-fg/25', side, compact ? 'border-t-success-fg' : 'border-l-success-fg'),
    error: cn('border-error-fg/25', side, compact ? 'border-t-error-fg' : 'border-l-error-fg'),
  }[accent as 'marigold' | 'success' | 'error'];
}

function VLine({ className }: { className?: string }) {
  return <span aria-hidden className={cn('mx-auto block w-[2px]', className)} style={{ backgroundImage: vDash }} />;
}

function Arrowhead() {
  return <span aria-hidden className="mx-auto block h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent" style={{ borderTopColor: LINE }} />;
}

function EdgeLabel({ label, lang }: { label: Bi; lang: GuideLang }) {
  return (
    <span
      className={cn(
        'mx-auto my-0.5 block max-w-full rounded-full border border-info-fg/25 bg-surface-card px-2 py-px text-center text-[0.625rem] font-semibold leading-snug text-info-fg [overflow-wrap:anywhere]',
        lang === 'en' ? 'uppercase tracking-[0.06em]' : 'text-[0.6875rem]',
      )}
    >
      {label[lang]}
    </span>
  );
}

/** A dashed line down with an arrowhead, and a label on it when there is one. */
function Connector({ label, lang }: { label?: Bi; lang: GuideLang }) {
  return (
    <div className="flex flex-col items-stretch">
      <VLine className={label ? 'h-2' : 'h-3.5'} />
      {label && <EdgeLabel label={label} lang={lang} />}
      <VLine className={label ? 'h-2' : 'h-1.5'} />
      <Arrowhead />
    </div>
  );
}

function NodeBox({ step, lang, compact }: { step: FlowStep; lang: GuideLang; compact: boolean }) {
  const Icon = step.icon;
  const tone = step.tone ?? 'action';
  return (
    <div
      className={cn(
        'relative mx-auto flex w-full rounded-md border bg-surface-card shadow-e1',
        compact ? 'min-h-[78px] flex-col items-center justify-center gap-1.5 px-1.5 py-2 text-center' : 'max-w-[260px] items-center gap-2.5 px-3 py-2',
        accentClass(tone, compact),
      )}
    >
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full', TONE[tone].icon)}>
        <Icon size={15} strokeWidth={1.75} aria-hidden />
      </span>
      <span
        className={cn(
          'min-w-0 font-semibold leading-tight text-ink-900 [overflow-wrap:anywhere]',
          lang === 'en' ? 'text-[0.6875rem] uppercase tracking-[0.05em] hyphens-auto' : 'text-[0.8125rem]',
        )}
      >
        {step.label[lang]}
      </span>
      {tone === 'ai' && (
        <span className="absolute -top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-marigold-400 px-1.5 py-px text-[0.5625rem] font-bold leading-tight text-ink-900">
          <Sparkles size={8} aria-hidden /> AI
        </span>
      )}
    </div>
  );
}

/** A box is laid out icon-over-label once its column is narrower than this. */
const COMPACT_BELOW = 210;
/** Columns narrower than this stack instead of sitting side by side. */
const STACK_BELOW = 92;

function HBar({ edge, first, last }: { edge: 'top' | 'bottom'; first: boolean; last: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('absolute h-[2px]', edge === 'top' ? 'top-0' : 'bottom-0')}
      style={{ left: first ? '50%' : 0, right: last ? '50%' : 0, backgroundImage: hDash }}
    />
  );
}

function BranchView({ row, lang, width, top, bottom }: { row: FlowBranch; lang: GuideLang; width: number; top: boolean; bottom: boolean }) {
  const n = row.branch.length;
  const colWidth = width / n;

  // Too narrow for side by side: one under another, on a rail.
  if (colWidth < STACK_BELOW) {
    return (
      <div className="flex flex-col">
        {top && <VLine className="h-3" />}
        <div className="ml-3 space-y-2 border-l-2 border-dashed pl-3" style={{ borderColor: LINE }}>
          {row.branch.map((col, j) => (
            <div key={j} className="pt-1">
              {col.edge && <EdgeLabel label={col.edge} lang={lang} />}
              <FlowView flow={col.flow} lang={lang} width={width - 32} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {top && <VLine className="h-3" />}
      <div className="flex items-stretch">
        {row.branch.map((col, j) => (
          <div key={j} className="relative flex min-w-0 flex-1 flex-col px-1">
            {top && n > 1 && <HBar edge="top" first={j === 0} last={j === n - 1} />}
            {top ? <Connector label={col.edge} lang={lang} /> : col.edge && <EdgeLabel label={col.edge} lang={lang} />}
            <FlowView flow={col.flow} lang={lang} width={colWidth - 8} />
            {bottom && <VLine className="min-h-3 flex-1" />}
            {bottom && n > 1 && <HBar edge="bottom" first={j === 0} last={j === n - 1} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowView({ flow, lang, width }: { flow: Flow; lang: GuideLang; width: number }) {
  return (
    <div className="flex flex-col">
      {flow.map((row, i) =>
        isBranch(row) ? (
          <BranchView key={i} row={row} lang={lang} width={width} top={i > 0} bottom={i < flow.length - 1} />
        ) : (
          <Fragment key={i}>
            {i > 0 && <Connector label={row.edge} lang={lang} />}
            <NodeBox step={row} lang={lang} compact={width < COMPACT_BELOW} />
          </Fragment>
        ),
      )}
    </div>
  );
}

function tonesIn(flow: Flow, into = new Set<Tone>()): Set<Tone> {
  for (const row of flow) {
    if (isBranch(row)) row.branch.forEach((c) => tonesIn(c.flow, into));
    else into.add(row.tone ?? 'action');
  }
  return into;
}

const LEGEND: Array<{ tones: Tone[]; dot: string; label: Bi }> = [
  { tones: ['action'], dot: 'bg-saffron-600', label: t('Your step', 'आपका काम') },
  { tones: ['ai', 'wait'], dot: 'bg-marigold-400', label: t('AI or waiting', 'AI या इंतज़ार') },
  { tones: ['done'], dot: 'bg-success-fg', label: t('Posted or done', 'पोस्ट या पूरा') },
  { tones: ['neutral'], dot: 'bg-ink-400', label: t('Returned, cancelled or closed', 'लौटाया, रद्द या बंद') },
  { tones: ['error'], dot: 'bg-error-fg', label: t('Overdue or a problem', 'बकाया या गड़बड़ी') },
];

export function GuideChart({ guide, lang }: { guide: Guide; lang: GuideLang }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const used = tonesIn(guide.flow);
  return (
    <figure className="min-w-0 rounded-lg border border-line-200 bg-surface-sink/60 px-3 pb-3 pt-4">
      <figcaption className="mb-4 text-center font-display text-body-lg font-semibold text-ink-900">{guide.title[lang]}</figcaption>
      <div ref={ref} className="min-w-0">
        <FlowView flow={guide.flow} lang={lang} width={width} />
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t border-line-200 pt-2.5">
        {LEGEND.filter((l) => l.tones.some((x) => used.has(x))).map((l) => (
          <li key={l.dot} className="flex items-center gap-1.5 text-caption text-ink-500">
            <span aria-hidden className={cn('h-2 w-2 rounded-full', l.dot)} />
            {l.label[lang]}
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ── The guide: chart, what you can do, the steps ──

export function GuideBody({ guide, lang, layout = 'stack' }: { guide: Guide; lang: GuideLang; layout?: 'stack' | 'split' }) {
  return (
    <div
      lang={lang}
      style={lang === 'hi' ? { fontFamily: HINDI_FONT } : undefined}
      className={cn(layout === 'split' ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]' : 'space-y-6')}
    >
      <GuideChart guide={guide} lang={lang} />
      <div className="min-w-0 space-y-6">
        <section>
          <h3 className="mb-2.5 font-display text-body-lg font-semibold text-ink-900">{UI.youCan[lang]}</h3>
          <ul className="space-y-2">
            {guide.can.map((point, i) => (
              <li key={i} className="flex gap-2.5 text-body text-ink-700">
                <span className="mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-brand-50 text-saffron-600">
                  <Check size={12} strokeWidth={2.5} aria-hidden />
                </span>
                <span>
                  <Rich text={point[lang]} />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2.5 font-display text-body-lg font-semibold text-ink-900">{UI.steps[lang]}</h3>
          <ol className="space-y-2.5">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-body text-ink-700">
                <span className="mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-line-200 bg-surface-card font-mono text-[0.6875rem] font-medium text-ink-700">
                  {i + 1}
                </span>
                <span>
                  <Rich text={step[lang]} />
                </span>
              </li>
            ))}
          </ol>
        </section>
        {guide.note && (
          <p className="rounded-md border border-info-fg/20 bg-info-bg px-3 py-2.5 text-caption text-info-fg">
            <Rich text={guide.note[lang]} />
          </p>
        )}
      </div>
    </div>
  );
}

export function LangSwitch() {
  const [lang, setLang] = useGuideLang();
  return (
    <div role="group" aria-label={UI.language[lang]} className="inline-flex shrink-0 rounded-full border border-line-200 bg-surface-card p-0.5">
      {(['en', 'hi'] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={cn(
            'min-h-[34px] rounded-full px-3.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400',
            lang === l ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-surface-sink',
          )}
        >
          {l === 'en' ? 'English' : 'हिंदी'}
        </button>
      ))}
    </div>
  );
}

function GuideState({ failed, retry, lang }: { failed: boolean; retry: () => void; lang: GuideLang }) {
  if (failed) {
    return (
      <p className="text-body text-ink-500">
        {UI.failed[lang]}{' '}
        <button type="button" onClick={retry} className="font-medium text-saffron-600 hover:underline">
          {UI.retry[lang]}
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-3" aria-live="polite">
      <p className="sr-only">{UI.loading[lang]}</p>
      <div className="h-64 animate-pulse rounded-lg bg-surface-sink" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-sink" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-surface-sink" />
    </div>
  );
}

/** The guide on the page itself: under an empty list, before anything exists. */
export function ModuleGuide({ guide: key, className }: { guide: GuideKey; className?: string }) {
  const { guide, failed, retry } = useGuide(key);
  const [lang] = useGuideLang();
  return (
    <section className={cn('rounded-xl border border-line-200 bg-surface-card p-5', className)} aria-label={UI.howItWorks[lang]}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-h3 text-ink-900" lang={lang} style={lang === 'hi' ? { fontFamily: HINDI_FONT } : undefined}>
          <BookOpen size={18} className="text-saffron-600" aria-hidden />
          {UI.howItWorks[lang]}
          {guide && <span className="text-ink-500">· {guide.section[lang]}</span>}
        </h2>
        <LangSwitch />
      </div>
      {guide ? <GuideBody guide={guide} lang={lang} layout="split" /> : <GuideState failed={failed} retry={retry} lang={lang} />}
    </section>
  );
}

function SheetContent({ guideKey }: { guideKey: GuideKey }) {
  const { guide, failed, retry } = useGuide(guideKey);
  const [lang] = useGuideLang();
  return (
    <>
      <div className="border-b border-line-200 bg-surface-card px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-saffron-600">
            <BookOpen size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1" lang={lang} style={lang === 'hi' ? { fontFamily: HINDI_FONT } : undefined}>
            <p className="text-caption text-ink-500">{UI.howItWorks[lang]}</p>
            <DialogPrimitive.Title className="font-display text-h3 text-ink-900">{guide ? guide.section[lang] : UI.howItWorks[lang]}</DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close
            aria-label={UI.close[lang]}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-surface-sink hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
          >
            <X size={18} aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div className="mt-3">
          <LangSwitch />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {guide ? <GuideBody guide={guide} lang={lang} /> : <GuideState failed={failed} retry={retry} lang={lang} />}
      </div>
    </>
  );
}

/** "How it works" in a page header: opens the guide in a panel on the right. */
export function GuideButton({ guide, className }: { guide: GuideKey; className?: string }) {
  const [open, setOpen] = useState(false);
  // Start fetching on intent, so the panel opens with its content ready.
  const prefetch = () => {
    loadGuide(guide).catch(() => undefined);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="secondary" className={className} onMouseEnter={prefetch} onFocus={prefetch}>
          <BookOpen size={15} aria-hidden /> How it works
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-roast-900/25 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-line-200 bg-surface-page shadow-e3 duration-200 focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right motion-reduce:animate-none"
        >
          <SheetContent guideKey={guide} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
