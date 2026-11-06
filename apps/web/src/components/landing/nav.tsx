'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ButtonLink, Logo, container } from './shared';

export const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#ai', label: 'AI' },
  { href: '#dashboard', label: 'Dashboard' },
  { href: '#pricing', label: 'Pricing' },
] as const;

/**
 * White, sticky, and quiet at rest: the border and shadow arrive only once
 * the page has moved under it. Below md the links fold into a menu.
 */
export function LandingNav() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Anchor links glide to their section, unless the reader asked for less motion.
  // Set on <html> only while this page is mounted, so the app is unaffected.
  useEffect(() => {
    if (reduce) return;
    const root = document.documentElement;
    const before = root.style.scrollBehavior;
    root.style.scrollBehavior = 'smooth';
    return () => {
      root.style.scrollBehavior = before;
    };
  }, [reduce]);

  // The menu closes on Escape (focus back on the toggle) and when the window
  // widens past the breakpoint where the links are shown inline.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      window.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b bg-surface-card transition-[box-shadow,border-color] duration-200',
        scrolled || open ? 'border-line-200 shadow-e1' : 'border-transparent',
      )}
    >
      <nav aria-label="Main" className={cn(container, 'flex h-16 items-center gap-6 lg:gap-10')}>
        <Link href="/" aria-label="AiBooks home" className="rounded-lg">
          <Logo />
        </Link>

        <ul className="hidden items-center gap-6 md:flex lg:gap-8">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="rounded-md text-body font-medium text-navy-900 hover:text-brand-700"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            // A live session lands here after a bookmark or sign-out redirect:
            // it should not be asked to sign in again.
            <ButtonLink href="/dashboard" className="hidden sm:inline-flex">
              Go to dashboard
              <ArrowRight size={16} aria-hidden />
            </ButtonLink>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden h-10 items-center rounded-xl px-3 text-body font-semibold text-navy-900 hover:bg-navy-50 md:inline-flex"
              >
                Sign in
              </Link>
              <ButtonLink href="/auth/signup" className="hidden sm:inline-flex">
                Get Started for Free
              </ButtonLink>
            </>
          )}

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-navy-900 hover:bg-navy-50 md:hidden"
          >
            {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id="landing-menu"
            key="menu"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-full border-b border-line-200 bg-surface-card shadow-e2 md:hidden"
          >
            <div className={cn(container, 'pb-6 pt-2')}>
              <ul className="flex flex-col">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={close}
                      className="block rounded-lg px-3 py-3 text-body-lg font-medium text-navy-900 hover:bg-navy-50"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-col gap-2 border-t border-line-100 pt-4">
                {user ? (
                  <ButtonLink href="/dashboard" size="lg" onClick={close}>
                    Go to dashboard
                    <ArrowRight size={16} aria-hidden />
                  </ButtonLink>
                ) : (
                  <>
                    <ButtonLink href="/auth/signup" size="lg" onClick={close}>
                      Get Started for Free
                    </ButtonLink>
                    <ButtonLink href="/auth/login" variant="outline" size="lg" onClick={close}>
                      Sign in
                    </ButtonLink>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
