'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';

/** What a scanned document can become, grouped as the books are. Each opens its form beside the file. */
const GROUPS: Array<{ label: string; items: Array<{ label: string; hint?: string; href: string }> }> = [
  {
    label: 'Purchases',
    items: [
      { label: 'New bill', href: '/purchases/bills/new' },
      { label: 'New expense', href: '/purchases/expenses/new' },
      { label: 'New purchase order', href: '/purchases/orders/new' },
      { label: 'New vendor credit', hint: 'Debit note', href: '/purchases/vendor-credits/new' },
    ],
  },
  {
    label: 'Parties',
    items: [
      { label: 'New customer', href: '/sales/customers/new' },
      { label: 'New vendor', href: '/purchases/vendors/new' },
    ],
  },
  {
    label: 'Accountant',
    items: [{ label: 'New manual journal', href: '/accountant/manual-journals/new' }],
  },
  {
    label: 'Sales',
    items: [
      { label: 'New quote', href: '/sales/quotes/new' },
      { label: 'New sales order', href: '/sales/orders/new' },
      { label: 'New invoice', href: '/sales/invoices/new' },
    ],
  },
];

const item =
  'flex cursor-pointer select-none items-baseline justify-between gap-4 rounded-md px-2.5 py-1.5 text-body text-ink-900 outline-none data-[highlighted]:bg-honey-50 data-[highlighted]:text-ink-900';

/**
 * "Add to ▾" on a scanned upload: opens the chosen form filled from what was
 * read, with the file beside it. Arrow keys move through it; Escape closes it.
 */
export function AddToMenu({ documentId, fileName }: { documentId: string; fileName?: string }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="inline-flex h-8 items-center gap-1 rounded-md border border-line-200 bg-surface-card px-2.5 text-caption font-medium text-ink-900 hover:bg-honey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 data-[state=open]:bg-honey-50"
        aria-label={fileName ? `Add ${fileName} to a new record` : 'Add to a new record'}
      >
        Add to <ChevronDown size={13} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[15rem] overflow-y-auto rounded-lg border border-line-200 bg-surface-card p-1 shadow-lg"
        >
          {GROUPS.map((g, i) => (
            <Fragment key={g.label}>
              {i > 0 && <Menu.Separator className="my-1 h-px bg-line-100" />}
              <Menu.Group>
                <Menu.Label className="px-2.5 pb-0.5 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">{g.label}</Menu.Label>
                {g.items.map((it) => (
                  <Menu.Item key={it.href} asChild className={item}>
                    <Link href={`${it.href}?document=${documentId}`}>
                      <span>{it.label}</span>
                      {it.hint && <span className="text-caption text-ink-400">{it.hint}</span>}
                    </Link>
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
