'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  CheckSquare,
  FileText,
  ShoppingCart,
  TrendingUp,
  Building2,
  ReceiptIndianRupee,
  BarChart3,
  Lightbulb,
  Settings,
  BookOpen,
  Briefcase,
  Users,
  Bell,
  FolderOpen,
  Bot,
  Target,
  ListChecks,
  PieChart,
  IndianRupee,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { href: '/inbox', label: 'Inbox', icon: <Inbox size={18} /> },
  { href: '/review', label: 'Review', icon: <CheckSquare size={18} /> },
  { href: '/vouchers', label: 'Vouchers', icon: <FileText size={18} /> },
  { href: '/accounts', label: 'Chart of accounts', icon: <BookOpen size={18} /> },
  { href: '/purchase', label: 'Purchase', icon: <ShoppingCart size={18} /> },
  { href: '/sales', label: 'Sales', icon: <TrendingUp size={18} /> },
  { href: '/banking', label: 'Banking', icon: <Building2 size={18} /> },
  { href: '/gst', label: 'GST', icon: <ReceiptIndianRupee size={18} /> },
  { href: '/reports', label: 'Reports', icon: <BarChart3 size={18} /> },
  { href: '/insights', label: 'Insights', icon: <Lightbulb size={18} /> },
];

/**
 * The practice-management views, for firms that manage client books.
 *
 * They live in this same sidebar rather than a separate workspace: a CA moves
 * between a client's ledger and their own practice constantly, and making that
 * a different app with a different nav means re-orienting on every switch.
 */
const practiceItems: NavItem[] = [
  { href: '/crm', label: 'Practice home', icon: <Briefcase size={18} /> },
  { href: '/crm/clients', label: 'Clients', icon: <Users size={18} /> },
  { href: '/crm/compliance', label: 'Compliance', icon: <Bell size={18} /> },
  { href: '/crm/documents', label: 'Document hub', icon: <FolderOpen size={18} /> },
  { href: '/crm/agent', label: 'Support agent', icon: <Bot size={18} /> },
  { href: '/crm/leads', label: 'Leads', icon: <Target size={18} /> },
  { href: '/crm/invoices', label: 'Fees', icon: <IndianRupee size={18} /> },
  { href: '/crm/tasks', label: 'Tasks', icon: <ListChecks size={18} /> },
  { href: '/crm/reports', label: 'Practice reports', icon: <PieChart size={18} /> },
];

interface SidebarProps {
  inboxCount?: number;
  reviewCount?: number;
  /**
   * The practice this org runs, when it has one. The Practice section shows
   * either way — an org without a firm lands on a short setup step rather than
   * being shown nothing, since hiding half the product is a worse answer than
   * offering to switch it on.
   */
  firmName?: string;
}

export function Sidebar({ inboxCount = 0, reviewCount = 0, firmName }: SidebarProps) {
  const pathname = usePathname();

  const itemsWithBadges = navItems.map((item) => ({
    ...item,
    badge:
      item.href === '/inbox' && inboxCount > 0
        ? inboxCount
        : item.href === '/review' && reviewCount > 0
          ? reviewCount
          : undefined,
  }));

  return (
    <aside
      className="fixed left-0 top-0 z-40 h-screen w-[260px] flex flex-col"
      style={{ backgroundColor: 'var(--roast-900)' }}
    >
      {/* Brand mark */}
      <div className="flex h-16 items-center px-6 border-b border-white/10">
        <span
          className="text-h3 font-display text-white"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ◆{' '}
          <span className="text-marigold-400">Ai</span>
          <span className="text-white">Books</span>
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-0.5 px-3">
          {itemsWithBadges.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-sm px-3 py-2.5 text-body transition-colors min-h-[44px]',
                    isActive
                      ? 'sidebar-active text-white'
                      : 'text-ink-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  <span className={isActive ? 'text-white' : 'text-ink-500'}>{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-marigold-400 px-1.5 text-[0.75rem] font-semibold text-ink-900">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <>
            <p className="mt-6 px-6 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {firmName ?? 'Practice'}
            </p>
            <ul className="space-y-0.5 px-3">
              {(firmName ? practiceItems : practiceItems.slice(0, 1)).map((item) => {
                // '/crm' must not light up for every practice page beneath it.
                const isActive =
                  item.href === '/crm' ? pathname === '/crm' : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex min-h-[44px] items-center gap-3 rounded-sm px-3 py-2.5 text-body transition-colors',
                        isActive
                          ? 'sidebar-active text-white'
                          : 'text-ink-400 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <span className={isActive ? 'text-white' : 'text-ink-500'}>{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
      </nav>

      {/* Settings at bottom */}
      <div className="border-t border-white/10 p-3">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-sm px-3 py-2.5 text-body transition-colors min-h-[44px]',
            pathname.startsWith('/settings')
              ? 'sidebar-active text-white'
              : 'text-ink-400 hover:text-white hover:bg-white/5',
          )}
        >
          <Settings size={18} className={pathname.startsWith('/settings') ? 'text-white' : 'text-ink-500'} />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
