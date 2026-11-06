'use client';

import Link from 'next/link';
import { Building2, Menu, Zap } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { UserMenu } from './user-menu';
import { NotificationsBell } from './notifications-bell';

/**
 * The app header.
 *
 * Everything here reads live: the org name, the AI meter and the account menu.
 * It previously rendered the org's ObjectId where its name belongs and a fixed
 * usage figure, which made the header look like a mock of itself.
 */
export function Topbar({ aiUsageLimitPaise = 100_000, onMenu }: { aiUsageLimitPaise?: number; /** Opens the sidebar drawer below lg. */ onMenu?: () => void }) {
  const { data: workspace, isLoading } = useWorkspace();

  const spentPaise = workspace?.aiUsage.spentPaise ?? 0;
  const usagePct = Math.min((spentPaise / aiUsageLimitPaise) * 100, 100);

  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-line-200 bg-surface-card/95 px-4 backdrop-blur transition-[left] duration-200 ease-out group-data-[dragging=true]/shell:transition-none sm:gap-4 sm:px-6 lg:left-[var(--sidebar-w)]">
      <button type="button" onClick={onMenu} aria-label="Open menu" className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-navy-900 hover:bg-honey-50 lg:hidden">
        <Menu size={20} />
      </button>
      {/* Which books you are looking at */}
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-900 sm:flex">
          <Building2 size={16} />
        </span>
        <div className="min-w-0">
          {isLoading ? (
            <span className="block h-4 w-32 animate-pulse rounded bg-line-200" />
          ) : (
            <span className="block truncate font-heading font-bold text-navy-900">
              {workspace?.org.name}
            </span>
          )}
          {workspace?.org.gstin ? (
            <span className="block truncate font-mono text-[10px] leading-tight text-ink-400">
              {workspace.org.gstin}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex-1" />

      {/* This org's own AI spend for the month */}
      <Link
        href="/insights"
        title={`AI spend for ${workspace?.aiUsage.period ?? 'this month'}`}
        className="hidden items-center gap-2 rounded-md border border-line-200 px-3 py-1.5 transition-colors hover:border-ink-300 hover:bg-honey-50 sm:flex"
      >
        <Zap size={14} className="text-marigold-400" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.7rem] leading-none text-ink-500">AI this month</span>
          <div className="flex items-center gap-2">
            <div className="h-1 w-16 overflow-hidden rounded-full bg-line-200">
              <div
                className="h-full rounded-full bg-marigold-400 transition-all"
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <span className="font-mono text-caption text-ink-700">
              ₹{(spentPaise / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </Link>

      {/* Notifications: a list of what needs you, each linking to where it is dealt with. */}
      <NotificationsBell />

      <UserMenu workspace={workspace} />
    </header>
  );
}
