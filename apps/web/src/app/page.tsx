'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  FileText,
  IndianRupee,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AuroraBackdrop,
  CountUp,
  FadeIn,
  HoverLift,
  Stagger,
  StaggerItem,
} from '@/components/motion/primitives';
import { useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { cn } from '@/lib/utils';
import { FinanceBackdrop } from '@/components/motion/finance-backdrop';
import { NoiseTexture } from '@/components/ui/noise-texture';
import { TextAnimate } from '@/components/ui/text-animate';
import { useAuth } from '@/lib/auth-context';

/**
 * Public landing page, aimed at CA firms.
 *
 * Every claim below maps to something the product actually does — the modules
 * named here are the ones behind /crm. Marketing that promises more than the
 * software delivers is a support ticket with a delay on it.
 */

const MODULES = [
  {
    icon: <Bell size={20} />,
    title: 'Deadlines that chase themselves',
    body: 'GST, TDS, ITR and ROC dates are generated for each client from the services you handle for them. Clients get reminded 7, 3 and 1 days before — you get a list of what is actually pending.',
  },
  {
    icon: <FileText size={20} />,
    title: 'Documents collected without asking twice',
    body: 'Send one request and the checklist builds itself from the service. When a client uploads, the file is matched to the item it satisfies — you just confirm it is the right one.',
  },
  {
    icon: <Bot size={20} />,
    title: 'An assistant that knows when to fetch you',
    body: 'Routine questions get answered from that client’s own records. Anything about fees, anything sensitive, anything it is unsure of comes straight to you instead.',
  },
  {
    icon: <TrendingUp size={20} />,
    title: 'Enquiries scored before you reply',
    body: 'New enquiries are read and scored so you know which are worth an hour. The AI recommends; moving a lead is always your call.',
  },
  {
    icon: <IndianRupee size={20} />,
    title: 'Fees that follow themselves up',
    body: 'Raise an invoice and the reminder ladder runs: a week before, on the day, then a week and a fortnight late. Numbering is gapless per financial year.',
  },
  {
    icon: <Users size={20} />,
    title: 'One client book',
    body: 'Every client, their constitution, their GSTIN, the services you provide and what is outstanding — in one place, searchable.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Add your clients',
    body: 'Name, constitution, GSTIN and the services you handle. That is all the setup there is.',
  },
  {
    n: '02',
    title: 'The calendar fills itself',
    body: 'Every statutory obligation each client owes appears automatically, with the right due date.',
  },
  {
    n: '03',
    title: 'The chasing runs daily',
    body: 'Deadline reminders, document requests and fee follow-ups go out on schedule, in Hinglish your clients read.',
  },
  {
    n: '04',
    title: 'You handle what matters',
    body: 'Approvals, judgement calls and anything the assistant escalated. The rest is already done.',
  },
];

const TRUST = [
  {
    icon: <ShieldCheck size={18} />,
    title: 'Your clients stay yours',
    body: 'Every record is scoped to your firm at the database layer, not just in the UI. One firm can never read another’s book.',
  },
  {
    icon: <CheckCircle2 size={18} />,
    title: 'The AI proposes, you commit',
    body: 'Nothing posts to a ledger and no lead moves stage without a person deciding. Every automated action is logged and attributable.',
  },
  {
    icon: <IndianRupee size={18} />,
    title: 'Money is exact',
    body: 'Every amount is stored in whole paise. No floating-point drift, no rupee that rounds away.',
  },
];

/**
 * A floating glass bar that contracts once you leave the top of the page.
 *
 * Two states rather than a continuous scrub: pinned to the page at rest, and a
 * narrower inset pill once scrolled. A continuously interpolated width chases
 * the scroll position and never settles, which reads as jitter; snapping
 * between two settled states at 8px of travel reads as intent.
 *
 * The blur only applies in the scrolled state — over the page background at
 * rest there is nothing behind it to blur, and the cost is real on long pages.
 */
function Nav() {
  const { user } = useAuth();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const reduced = useReducedMotion();

  useMotionValueEvent(scrollY, 'change', (y) => {
    // A dead band: without it, a trackpad resting near the threshold flickers
    // the bar between both states.
    setScrolled((was) => (was ? y > 8 : y > 24));
  });

  const linkClass =
    'text-body text-ink-700 transition-colors hover:text-ink-900';

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4">
      <motion.nav
        initial={false}
        animate={{
          marginTop: scrolled ? 12 : 0,
          maxWidth: scrolled ? 880 : 1152,
          paddingTop: scrolled ? 8 : 14,
          paddingBottom: scrolled ? 8 : 14,
          borderRadius: scrolled ? 999 : 0,
        }}
        transition={
          reduced
            ? { duration: 0 }
            : // Slightly overdamped: it arrives without the bounce that would
              // make a navigation bar feel like a toy.
              { type: 'spring', stiffness: 320, damping: 34, mass: 0.7 }
        }
        className={cn(
          'pointer-events-auto flex w-full items-center gap-6 px-6',
          scrolled
            ? 'border border-line-200/70 bg-surface-page/70 shadow-e2 backdrop-blur-xl backdrop-saturate-150'
            : 'border border-transparent border-b-line-200/60 bg-surface-page/85',
        )}
      >
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-saffron-600 font-heading text-caption font-bold text-white">
            CA
          </span>
          <span className="font-heading text-body font-semibold text-ink-900">Practice</span>
        </Link>

        <div className="ml-auto hidden items-center gap-6 sm:flex">
          <Link href="#modules" className={linkClass}>
            What it does
          </Link>
          <Link href="#how" className={linkClass}>
            How it works
          </Link>
          <Link href="#trust" className={linkClass}>
            Safeguards
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {user ? (
            // Signing out lands here, and so does a bookmark. Someone with a
            // live session should not be asked to sign in again.
            <Button size="sm" asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/auth/login">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/auth/signup">Start free</Link>
              </Button>
            </>
          )}
        </div>
      </motion.nav>
    </header>
  );
}

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-24 pt-32 sm:pt-40">
        <AuroraBackdrop />
        <FinanceBackdrop />
        {/* A little grain over the wash. Flat gradients read as cheap at this
            scale; the texture is what stops the background looking like a
            default. Barely visible on purpose — 3.5% is the point. */}
        <NoiseTexture
          className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
          frequency={0.8}
          noiseOpacity={1}
        />

        <div className="relative mx-auto max-w-4xl text-center">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-line-200 bg-surface-card/80 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700 shadow-e1 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-saffron-600" />
              Built for Indian CA firms
            </span>
          </FadeIn>

          {/* Word-by-word blur-up. Slow enough to read as deliberate rather
              than decorative, and it settles before anyone finishes the line. */}
          <h1 className="mt-8 font-heading text-display-xl text-ink-900">
            <TextAnimate
              as="span"
              by="word"
              animation="blurInUp"
              duration={0.5}
              delay={0.1}
              className="block"
            >
              Stop chasing.
            </TextAnimate>
            <TextAnimate
              as="span"
              by="word"
              animation="blurInUp"
              duration={0.5}
              delay={0.35}
              className="block text-saffron-600"
            >
              Start closing the month.
            </TextAnimate>
          </h1>

          <FadeIn delay={0.7}>
            <p className="mx-auto mt-7 max-w-2xl text-body-lg text-ink-500">
              Practice management for chartered accountants. Deadlines, documents and fees chase
              themselves — in Hinglish your clients actually read — so your team spends its day on
              the work only a CA can do.
            </p>
          </FadeIn>

          <FadeIn delay={0.8}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="gap-2 shadow-e2" asChild>
                <Link href="/auth/signup">
                  Start free
                  <ArrowRight size={16} />
                </Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="#how">See how it works</Link>
              </Button>
            </div>
            <p className="mt-4 text-caption text-ink-400">
              No card required · Your data stays scoped to your firm
            </p>
          </FadeIn>
        </div>

        {/* Numbers that describe the product, not invented traction. */}
        <FadeIn delay={0.9}>
          <div className="relative mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-200 bg-line-200 shadow-e1 sm:grid-cols-4">
            {[
              { value: 6, suffix: '', label: 'Statutory filings tracked' },
              { value: 3, suffix: '', label: 'Reminders before each due date' },
              { value: 4, suffix: '', label: 'Rungs on the fee ladder' },
              { value: 100, suffix: '%', label: 'Of AI actions logged' },
            ].map((s) => (
              <div key={s.label} className="group bg-surface-card px-4 py-6 text-center transition-colors hover:bg-honey-50">
                <p className="font-mono text-h2 font-bold tabular-nums text-ink-900">
                  <CountUp to={s.value} suffix={s.suffix} />
                </p>
                <p className="mx-auto mt-1.5 max-w-[14ch] text-[11px] leading-tight text-ink-500">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>

      {/* ── Modules ───────────────────────────────────────────────────── */}
      <section id="modules" className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <FadeIn>
            <h2 className="font-heading text-display-lg text-ink-900">
              What your firm stops doing by hand
            </h2>
            <p className="mt-2 max-w-2xl text-ink-500">
              Six modules, each replacing a job someone currently does on a Tuesday evening.
            </p>
          </FadeIn>

          <Stagger className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <StaggerItem key={m.title}>
                <HoverLift className="h-full">
                  <article className="h-full rounded-2xl border border-line-200 bg-surface-card p-5 transition-colors hover:border-saffron-600/40">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-honey-100 text-saffron-700">
                      {m.icon}
                    </span>
                    <h3 className="mt-4 font-heading text-h3 text-ink-900">
                      {m.title}
                    </h3>
                    <p className="mt-2 text-body text-ink-500">{m.body}</p>
                  </article>
                </HoverLift>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section id="how" className="bg-surface-sink px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <FadeIn>
            <h2 className="font-heading text-display-lg text-ink-900">
              Set up in an afternoon
            </h2>
            <p className="mt-2 max-w-2xl text-ink-500">
              There is no implementation project. Add clients, and the rest follows.
            </p>
          </FadeIn>

          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" gap={0.1}>
            {STEPS.map((s) => (
              <StaggerItem key={s.n}>
                <div className="h-full rounded-2xl border border-line-200 bg-surface-card p-5">
                  <span className="font-mono text-caption font-bold text-saffron-600">{s.n}</span>
                  <h3 className="mt-2 font-heading text-h3 text-ink-900">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-body text-ink-500">{s.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── A real message ────────────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
          <FadeIn>
            <h2 className="font-heading text-display-lg text-ink-900">
              Written the way your clients write
            </h2>
            <p className="mt-3 text-ink-500">
              Reminders and replies go out in Hinglish, not corporate English. Your team reads the
              app in English; your client reads a message that sounds like a person from your
              office wrote it.
            </p>
            <p className="mt-3 text-ink-500">
              And when the question turns to fees, a notice, or anything the assistant is unsure
              of, it stops and hands the thread to you — with a holding message already sent so the
              client is not left waiting.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="rounded-2xl border border-line-200 bg-surface-card p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 border-b border-line-200 pb-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-sink text-caption font-semibold text-ink-700">
                  RM
                </span>
                <div>
                  <p className="text-body font-medium text-ink-900">Ramesh Mehta</p>
                  <p className="font-mono text-[11px] text-ink-400">WhatsApp</p>
                </div>
              </div>

              <Stagger className="space-y-2.5" gap={0.35}>
                <StaggerItem>
                  <div className="max-w-[85%] rounded-xl bg-surface-sink px-3 py-2">
                    <p className="text-body text-ink-900">
                      Namaste, GSTR-3B August ka kab tak bharna hai?
                    </p>
                  </div>
                </StaggerItem>
                <StaggerItem>
                  <div className="ml-auto max-w-[85%] rounded-xl bg-saffron-600 px-3 py-2">
                    <p className="text-body text-white">
                      Namaste Ramesh ji! Aapka August ka GSTR-3B 20 September tak bharna hai. Bank
                      statement abhi pending hai — bhej dijiye to hum time par file kar denge.
                    </p>
                  </div>
                </StaggerItem>
                <StaggerItem>
                  <div className="max-w-[85%] rounded-xl bg-surface-sink px-3 py-2">
                    <p className="text-body text-ink-900">Fees kitni hogi?</p>
                  </div>
                </StaggerItem>
                <StaggerItem>
                  <div className="rounded-xl border border-pending-fg/20 bg-pending-bg px-3 py-2">
                    <p className="text-caption font-semibold text-pending-fg">
                      Handed to you — fee question
                    </p>
                    <p className="mt-0.5 text-caption text-pending-fg/80">
                      The assistant never quotes a price. Client told someone will reply.
                    </p>
                  </div>
                </StaggerItem>
              </Stagger>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Safeguards ────────────────────────────────────────────────── */}
      <section id="trust" className="bg-roast-900 px-6 py-20 text-white">
        <div className="mx-auto max-w-5xl">
          <FadeIn>
            <h2 className="font-heading text-display-lg">
              Built so you can defend every entry
            </h2>
            <p className="mt-2 max-w-2xl text-white/60">
              Automation is only useful in a practice if it is auditable. These are structural, not
              settings someone can switch off.
            </p>
          </FadeIn>

          <Stagger className="mt-10 grid gap-4 md:grid-cols-3">
            {TRUST.map((t) => (
              <StaggerItem key={t.title}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/5 p-5">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-marigold-400/15 text-marigold-300">
                    {t.icon}
                  </span>
                  <h3 className="mt-3 font-heading text-h3">{t.title}</h3>
                  <p className="mt-2 text-body text-white/60">{t.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <FadeIn>
          <div className="mx-auto max-w-3xl rounded-3xl border border-line-200 bg-surface-card px-8 py-14 text-center">
            <h2 className="font-heading text-display-lg text-ink-900">
              Give your evenings back
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-ink-500">
              Add your client book and watch the first month of deadlines appear. If it does not
              save your team an afternoon in the first week, nothing is lost.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {user ? (
                <Button size="lg" className="gap-2" asChild>
                  <Link href="/dashboard">
                    Go to dashboard
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button size="lg" className="gap-2" asChild>
                    <Link href="/auth/signup">
                      Start free
                      <ArrowRight size={16} />
                    </Link>
                  </Button>
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/auth/login">Sign in</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </FadeIn>
      </section>

      <footer className="border-t border-line-200 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 text-body text-ink-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-saffron-600 font-heading text-[10px] font-bold text-white">
            CA
          </span>
          <span>Practice management for Indian chartered accountants.</span>
          <span className="ml-auto font-mono text-caption text-ink-400">
            © {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </main>
  );
}
