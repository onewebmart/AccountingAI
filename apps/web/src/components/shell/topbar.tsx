'use client';

import Link from 'next/link';
import { Bell, Building2, Zap } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { UserMenu } from './user-menu';

/**
 * The app header.
 *
 * Everything here reads live: the org name, the AI meter and the account menu.
 * It previously rendered the org's ObjectId where its name belongs and a fixed
 * usage figure, which made the header look like a mock of itself.
 */
export function Topbar({ aiUsageLimitPaise = 100_000 }: { aiUsageLimitPaise?: number }) {
  const { data: workspace, isLoading } = useWorkspace();

  const spentPaise = workspace?.aiUsage.spentPaise ?? 0;
  const usagePct = Math.min((spentPaise / aiUsageLimitPaise) * 100, 100);

  return (
    <header className="fixed left-[260px] right-0 top-0 z-30 flex h-16 items-center gap-4 border-b border-line-200 bg-surface-card px-6">
      {/* Which books you are looking at */}
      <div className="flex min-w-0 items-center gap-2 px-1">
        <Building2 size={16} className="shrink-0 text-ink-400" />
        <div className="min-w-0">
          {isLoading ? (
            <span className="block h-4 w-32 animate-pulse rounded bg-line-200" />
          ) : (
            <span className="block truncate font-medium text-ink-900">
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
        className="flex items-center gap-2 rounded-sm border border-line-200 px-3 py-1.5 transition-colors hover:bg-honey-50"
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

      {/* Notifications: the dot appears only when something actually needs you. */}
      <Link
        href="/review"
        aria-label={
          workspace?.counts.review
            ? `${workspace.counts.review} entries waiting for review`
            : 'Nothing waiting for review'
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-honey-50"
      >
        <Bell size={18} />
        {workspace && workspace.counts.review > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-saffron-600" />
        ) : null}
      </Link>

      <UserMenu workspace={workspace} />
    </header>
  );
}
