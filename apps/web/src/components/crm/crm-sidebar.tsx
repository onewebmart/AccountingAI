'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Bot,
  CheckSquare,
  FileText,
  LayoutDashboard,
  ReceiptIndianRupee,
  Settings,
  TrendingUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Amber count pill — pending work, per the design system. */
  badge?: number;
  /**
   * False until that phase of CA_CRM_BUILD_PLAN.md ships. Unbuilt routes render
   * as disabled rather than linking to a 404, so the nav shows the real target
   * information architecture without pretending the views exist.
   */
  ready?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Mirrors the ten views of the CA CRM prototype, grouped the same way.
 * Labels are English (app chrome); client-facing copy stays Hinglish.
 */
const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ href: '/crm', label: 'Dashboard', icon: <LayoutDashboard size={18} /> }],
  },
  {
    title: 'AI modules',
    items: [
      { href: '/crm/agent', label: 'Support agent', icon: <Bot size={18} /> },
      { href: '/crm/documents', label: 'Document hub', icon: <FileText size={18} />, ready: true },
      { href: '/crm/compliance', label: 'Compliance', icon: <Bell size={18} />, ready: true },
      { href: '/crm/leads', label: 'Leads', icon: <TrendingUp size={18} />, ready: true },
      { href: '/crm/invoices', label: 'Invoices', icon: <ReceiptIndianRupee size={18} /> },
    ],
  },
  {
    title: 'Management',
    items: [
      { href: '/crm/clients', label: 'Clients', icon: <Users size={18} />, ready: true },
      { href: '/crm/tasks', label: 'Tasks', icon: <CheckSquare size={18} /> },
      { href: '/crm/reports', label: 'Reports', icon: <BarChart3 size={18} /> },
    ],
  },
  {
    title: 'Settings',
    items: [{ href: '/crm/settings', label: 'Settings', icon: <Settings size={18} />, ready: true }],
  },
];

export function CrmSidebar({ firmName }: { firmName: string }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[260px] flex-col border-r border-line-200 bg-surface-card">
      {/* Firm identity */}
      <div className="flex items-center gap-3 border-b border-line-200 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-saffron-600 font-heading text-sm font-bold text-white">
          CA
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-ink-900">{firmName}</p>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Chartered Accountants</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                // '/crm' must not match every child route.
                const active =
                  item.href === '/crm' ? pathname === '/crm' : pathname.startsWith(item.href);

                if (!item.ready) {
                  return (
                    <li key={item.href}>
                      <span
                        aria-disabled="true"
                        title="Not built yet"
                        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400"
                      >
                        <span className="text-ink-400">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-full bg-surface-sink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                          Soon
                        </span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-honey-100 font-semibold text-saffron-700'
                          : 'text-ink-700 hover:bg-surface-sink',
                      )}
                    >
                      <span className={active ? 'text-saffron-600' : 'text-ink-500'}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-pending-bg px-2 py-0.5 font-mono text-[11px] font-semibold text-pending-fg">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Back to the bookkeeping app */}
      <div className="border-t border-line-200 p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-500 transition-colors hover:bg-surface-sink hover:text-ink-700"
        >
          ← Back to books
        </Link>
      </div>
    </aside>
  );
}
