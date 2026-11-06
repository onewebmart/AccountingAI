'use client';

import { Check, Gauge } from 'lucide-react';
import { Reveal, RevealGroup, RevealItem } from './reveal';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ButtonLink, Eyebrow, container, h2Class, sectionY } from './shared';

// PLACEHOLDER prices: set the real plans before launch.
// No prices are defined anywhere else in the product yet; these exist only so
// the page has a shape. Amounts are whole rupees for display.
const PLANS: Array<{
  name: string;
  priceRupees: number;
  period: string;
  blurb: string;
  features: string[];
  cta: string;
  popular?: boolean;
}> = [
  {
    name: 'Free',
    priceRupees: 0,
    period: '/month',
    blurb: 'For a business getting its books in order.',
    features: ['One business', 'Core invoicing', 'Expenses', 'GST returns', '50 AI document reads a month'],
    cta: 'Get Started for Free',
  },
  {
    name: 'Growth',
    priceRupees: 999,
    period: '/month',
    blurb: 'For a growing team that wants every module.',
    features: [
      'Everything in Free',
      'Up to 5 users',
      '500 AI document reads a month',
      'Bank reconciliation',
      'All reports',
      'Time tracking',
    ],
    cta: 'Start with Growth',
    popular: true,
  },
  {
    name: 'CA Firm',
    priceRupees: 2999,
    period: '/month',
    blurb: 'For a practice that keeps books for its clients.',
    features: [
      'Everything in Growth',
      'Multiple client books',
      'Compliance deadlines: GST, TDS, ITR, ROC',
      'Document requests',
      'Practice invoices',
      'White-label client portal',
    ],
    cta: 'Start with CA Firm',
  },
];

export function Pricing() {
  const { user } = useAuth();

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={cn('scroll-mt-16 bg-surface-card', sectionY)}>
      <div className={container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 id="pricing-title" className={cn(h2Class, 'mt-3')}>
            Simple plans that grow with you
          </h2>
          <p className="mt-4 text-balance text-body-lg text-ink-500">
            Start free. Move up when you need more people, more AI reads or your clients’ books.
          </p>
        </Reveal>

        <RevealGroup className="mx-auto mt-12 grid max-w-md gap-6 lg:max-w-none lg:grid-cols-3 lg:items-stretch" gap={0.1}>
          {PLANS.map((p) => (
            <RevealItem key={p.name} className="h-full">
              <article
                aria-labelledby={`plan-${p.name}`}
                className={cn(
                  'relative flex h-full flex-col rounded-2xl bg-surface-card p-6 transition-[box-shadow,border-color] duration-200 sm:p-8',
                  p.popular
                    ? 'border-2 border-brand-600 shadow-e3'
                    : 'border border-line-200 shadow-e1 hover:border-navy-200 hover:shadow-e2',
                )}
              >
                {p.popular && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-700 px-3 py-1 text-caption font-semibold text-white shadow-e1">
                    Most popular
                  </span>
                )}
                <h3 id={`plan-${p.name}`} className="font-heading text-h3 text-navy-900">
                  {p.name}
                </h3>
                <p className="mt-1 text-body text-ink-500">{p.blurb}</p>
                <p className="mt-6 flex items-baseline gap-1">
                  <span className="font-heading text-[2.5rem] font-extrabold leading-none tracking-[-0.02em] text-navy-900">
                    ₹{p.priceRupees.toLocaleString('en-IN')}
                  </span>
                  <span className="text-body text-ink-500">{p.period}</span>
                </p>

                <ul className="mt-6 flex-1 space-y-3 border-t border-line-100 pt-6">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-3 text-body text-ink-700">
                      <Check size={18} className="mt-0.5 shrink-0 text-brand-600" strokeWidth={2.5} aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {user ? (
                    <ButtonLink href="/dashboard" variant={p.popular ? 'primary' : 'outline'} size="lg" className="w-full">
                      Go to dashboard
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/auth/signup" variant={p.popular ? 'primary' : 'outline'} size="lg" className="w-full">
                      {p.cta}
                    </ButtonLink>
                  )}
                </div>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-10">
          <p className="mx-auto flex max-w-3xl items-start gap-2 text-body text-ink-500 sm:items-center sm:justify-center sm:text-center">
            <Gauge size={18} className="mt-0.5 shrink-0 text-brand-700 sm:mt-0" aria-hidden />
            AI usage is shown every month in the app, so you can always see how many reads you have used.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
