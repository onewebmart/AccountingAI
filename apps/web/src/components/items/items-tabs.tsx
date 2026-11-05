'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/items', label: 'Items' },
  { href: '/stock', label: 'Stock' },
];

/** Items and their stock are one entry in the sidebar: this switches between the two pages. */
export function ItemsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-4">
      <nav aria-label="Items and stock" className="inline-flex rounded-md border border-line-200 bg-surface-sink p-1">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-sm px-4 py-1.5 text-body font-medium transition-colors',
                active ? 'bg-surface-card text-ink-900 shadow-e1' : 'text-ink-500 hover:text-ink-900',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
