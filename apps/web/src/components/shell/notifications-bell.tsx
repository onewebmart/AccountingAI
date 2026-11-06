'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  CheckCheck,
  CheckSquare,
  FileWarning,
  Landmark,
  Loader2,
  Receipt,
  ReceiptIndianRupee,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Kind = 'review' | 'approvals' | 'documents_failed' | 'overdue_invoices' | 'bills_due' | 'tds_due' | 'gst_due' | 'bank_unmatched';

/** GET /workspace/notifications: worked out from the books as they are now. */
interface Notification {
  key: string;
  kind: Kind;
  tone: 'pending' | 'error' | 'info';
  title: string;
  body: string;
  href: string;
  at: string;
  unread: boolean;
}
interface NotificationList {
  items: Notification[];
  unread: number;
  seenAt: string | null;
}

const ICON: Record<Kind, LucideIcon> = {
  review: CheckSquare,
  approvals: UserCheck,
  documents_failed: FileWarning,
  overdue_invoices: ReceiptIndianRupee,
  bills_due: Receipt,
  tds_due: CalendarClock,
  gst_due: CalendarClock,
  bank_unmatched: Landmark,
};

/** Amber waits on someone, red is late or broken, blue is to tidy up. */
const TONE: Record<Notification['tone'], string> = {
  pending: 'bg-pending-bg text-pending-fg',
  error: 'bg-error-bg text-error-fg',
  info: 'bg-info-bg text-info-fg',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The bell: a list of what needs you, each a link to where it is dealt with.
 * Opening it marks what is listed as read; the list itself only shrinks as
 * things are dealt with, since it is worked out from the books.
 */
export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationList>('/workspace/notifications'),
    refetchInterval: 60_000,
  });
  const seen = useMutation({ mutationFn: () => api.post('/workspace/notifications/seen') });

  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Read once opened; the rows keep their unread look until the list closes.
    if (next && unread > 0) seen.mutate();
    if (!next) void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-md text-navy-900 transition-colors hover:bg-honey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
            open && 'bg-honey-50',
          )}
        >
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error-fg px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line-200 bg-surface-card shadow-e3 data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-line-100 px-4 py-3">
            <p className="font-heading text-body-lg font-bold text-navy-900">Notifications</p>
            {items.length > 0 && (
              <span className="text-caption text-ink-500">
                {items.length} to look at
              </span>
            )}
          </div>

          <div className="max-h-[min(70vh,520px)] overflow-y-auto">
            {q.isLoading ? (
              <p className="flex items-center gap-2 px-4 py-8 text-caption text-ink-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            ) : q.isError ? (
              <p className="px-4 py-8 text-caption text-error-fg">Notifications could not load. Try again in a moment.</p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <CheckCheck size={18} />
                </span>
                <p className="font-semibold text-navy-900">You&apos;re all caught up</p>
                <p className="text-caption text-ink-500">Nothing needs you right now.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line-100">
                {items.map((n) => {
                  const Icon = ICON[n.kind] ?? Bell;
                  return (
                    <li key={n.key}>
                      <Menu.Item asChild>
                        <Link
                          href={n.href}
                          className={cn(
                            'flex gap-3 px-4 py-3 outline-none transition-colors hover:bg-navy-50 focus:bg-navy-50',
                            n.unread && 'bg-brand-50/40',
                          )}
                        >
                          <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[n.tone])}>
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className={cn('text-body text-navy-900', n.unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                              {n.unread && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-caption text-ink-500">{n.body}</span>
                            <span className="mt-1 block text-[11px] text-ink-400">{timeAgo(n.at)}</span>
                          </span>
                        </Link>
                      </Menu.Item>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="border-t border-line-100 bg-surface-sink/60 px-4 py-2 text-[11px] text-ink-500">
            Worked out from your books; each one clears once it is dealt with.
          </p>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
