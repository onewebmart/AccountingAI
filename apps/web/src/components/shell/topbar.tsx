'use client';

import { Bell, ChevronDown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TopbarProps {
  orgName?: string;
  aiUsagePaise?: number;
  aiUsageLimitPaise?: number;
}

export function Topbar({
  orgName = 'My Company',
  aiUsagePaise = 0,
  aiUsageLimitPaise = 100000,
}: TopbarProps) {
  const usagePct = Math.min((aiUsagePaise / aiUsageLimitPaise) * 100, 100);
  const usageRupees = (aiUsagePaise / 100).toFixed(0);

  return (
    <header className="fixed left-[260px] right-0 top-0 z-30 flex h-16 items-center gap-4 border-b border-line-200 bg-surface-card px-6">
      {/* Org switcher */}
      <button className="flex items-center gap-2 rounded-sm px-3 py-2 text-body text-ink-700 hover:bg-honey-50 min-h-[44px]">
        <span className="font-medium">{orgName}</span>
        <ChevronDown size={16} className="text-ink-400" />
      </button>

      <div className="flex-1" />

      {/* AI usage meter */}
      <div className="flex items-center gap-2 rounded-sm border border-line-200 px-3 py-1.5">
        <Zap size={14} className="text-marigold-400" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.7rem] text-ink-500 leading-none">AI this month</span>
          <div className="flex items-center gap-2">
            <div className="h-1 w-16 overflow-hidden rounded-full bg-line-200">
              <div
                className="h-full rounded-full bg-marigold-400 transition-all"
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <span className="text-caption font-mono text-ink-700">₹{usageRupees}</span>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <Button variant="ghost" size="icon" className="relative">
        <Bell size={18} />
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-saffron-600" />
      </Button>

      {/* Avatar */}
      <button className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron-600 text-white text-sm font-semibold">
        U
      </button>
    </header>
  );
}
