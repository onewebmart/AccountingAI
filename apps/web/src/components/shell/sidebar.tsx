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

interface SidebarProps {
  inboxCount?: number;
  reviewCount?: number;
  /** Set when this org is managed by a CA firm — adds a link to their CRM. */
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
