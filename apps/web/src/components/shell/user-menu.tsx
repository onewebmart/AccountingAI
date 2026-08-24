'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import type { Workspace } from '@/lib/use-workspace';

/** The avatar menu: who you are, settings, and a working sign-out. */
export function UserMenu({ workspace }: { workspace?: Workspace }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a menu that traps you is worse than
  // no menu.
  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = workspace?.user.initials ?? user?.email?.slice(0, 2).toUpperCase() ?? '?';
  const name = workspace?.user.name ?? user?.email ?? '';
  const email = workspace?.user.email ?? user?.email ?? '';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron-600 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initials}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-line-200 bg-surface-card shadow-lg"
        >
          <div className="border-b border-line-200 px-4 py-3">
            <p className="truncate text-sm font-medium text-ink-900">{name}</p>
            <p className="truncate text-xs text-ink-500">{email}</p>
            {workspace?.user.role ? (
              <p className="mt-1 inline-block rounded bg-surface-sink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                {workspace.user.role.replace(/_/g, ' ')}
              </p>
            ) : null}
          </div>

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-700 hover:bg-surface-sink"
          >
            <Settings size={15} className="text-ink-500" />
            Settings
          </Link>

          {workspace?.firm ? (
            <Link
              href="/crm"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-700 hover:bg-surface-sink"
            >
              <UserIcon size={15} className="text-ink-500" />
              {workspace.firm.name}
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2.5 border-t border-line-200 px-4 py-2.5 text-left text-sm text-[#C92A2A] hover:bg-[#C92A2A]/5"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
