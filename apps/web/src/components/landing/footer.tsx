import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Logo, container } from './shared';

/**
 * Links only to what exists: the page's own sections and the two auth
 * routes. There are no About, Careers or Privacy pages yet, so there are no
 * links to them.
 */
const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: 'Product',
    links: [
      { href: '#features', label: 'Features' },
      { href: '#ai', label: 'AI' },
      { href: '#dashboard', label: 'Dashboard' },
      { href: '#pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Inside AiBooks',
    links: [
      { href: '#ask', label: 'Ask your books' },
      { href: '#ca-firms', label: 'For CA firms' },
      { href: '#safeguards', label: 'Safeguards' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/auth/signup', label: 'Create a free account' },
      { href: '/auth/login', label: 'Sign in' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-navy-950 text-navy-200">
      <div className={cn(container, 'py-12 sm:py-16')}>
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr] lg:gap-16">
          <div className="max-w-sm">
            <Link href="/" aria-label="AiBooks home" className="inline-flex rounded-lg">
              <Logo tone="light" />
            </Link>
            <p className="mt-4 text-body text-navy-200">
              AI accounting for Indian SMEs and CA firms. The AI suggests every entry; a person
              approves it before it reaches the books.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="text-caption font-semibold uppercase tracking-[0.12em] text-white">{c.title}</p>
                <ul className="mt-4 space-y-3">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      {l.href.startsWith('#') ? (
                        <a href={l.href} className="rounded-sm text-body text-navy-200 hover:text-white">
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className="rounded-sm text-body text-navy-200 hover:text-white">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-caption text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AiBooks. Built for Indian SMEs and CA firms.</p>
          <p>Guides in English and Hindi for every section.</p>
        </div>
      </div>
    </footer>
  );
}
