'use client';

import { ArrowRight } from 'lucide-react';
import { Reveal } from './reveal';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ButtonLink, container } from './shared';

/** The closing call to action, on primary navy. */
export function CtaBand() {
  const { user } = useAuth();

  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden bg-navy-900 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 50% 80% at 50% 50%, #000 10%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 50% 80% at 50% 50%, #000 10%, transparent 70%)',
        }}
      />
      <div className={cn(container, 'relative py-16 text-center sm:py-24')}>
        <Reveal>
          <h2
            id="cta-title"
            className="mx-auto max-w-3xl font-heading text-[2rem] font-extrabold leading-[1.15] tracking-[-0.02em] text-white sm:text-[2.5rem] lg:text-[2.75rem]"
          >
            Ready to see your business clearly?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-body-lg text-navy-200">
            Create your account, upload your first bill and watch AiBooks propose the entry. You
            decide what posts.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            {user ? (
              <ButtonLink href="/dashboard" size="lg">
                Go to dashboard
                <ArrowRight size={18} aria-hidden />
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/auth/signup" size="lg">
                  Get Started for Free
                  <ArrowRight size={18} aria-hidden />
                </ButtonLink>
                <ButtonLink href="/auth/login" variant="outlineOnDark" size="lg">
                  Sign in
                </ButtonLink>
              </>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
