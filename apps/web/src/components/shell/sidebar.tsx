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
  ShieldCheck,
  MessageSquare,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

/**
 * The main board — one list, books and practice together.
 *
 * These were two sections with two headings. A CA moves between a client's
 * ledger and their own practice constantly, and a heading between them framed
 * that as crossing into a different product when it is the same day's work.
 */
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

/** Practice views, appended to the same list once the org has a firm. */
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
  { href: '/crm/settings', label: 'Messaging', icon: <MessageSquare size={18} /> },
  // The only route to /firm/config — white-label branding and the client
  // portal domain could not be configured from anywhere before this.
  { href: '/firm-portal', label: 'Firm & branding', icon: <Palette size={18} /> },
];

interface SidebarProps {
  inboxCount?: number;
  reviewCount?: number;
  /**
   * The practice this org runs, when it has one. Without a firm the list ends
   * at a single setup entry rather than hiding that half of the product.
   */
  firmName?: string;
  /**
   * The signed-in user's role.
   *
   * There are two boards, not three. A platform admin runs the platform and has
   * no books of their own, so they get the admin board alone; everyone else gets
   * the main board, which carries the whole product.
   */
  role?: string;
}

export function Sidebar({ inboxCount = 0, reviewCount = 0, firmName, role }: SidebarProps) {
  const pathname = usePathname();
  const isPlatformAdmin = role === 'PLATFORM_SUPER_ADMIN';

  // One list. Practice is appended rather than sectioned off; an org with no
  // firm gets only the first entry, which is the short setup step.
  const mainBoard: NavItem[] = isPlatformAdmin
    ? []
    : [...navItems, ...(firmName ? practiceItems : practiceItems.slice(0, 1))];

  const itemsWithBadges = mainBoard.map((item) => ({
    ...item,
    badge:
      item.href === '/inbox' && inboxCount > 0
        ? inboxCount
        : item.href === '/review' && reviewCount > 0
          ? reviewCount
          : undefined,
  }));

  const linkClass = (isActive: boolean) =>
    cn(
      'flex min-h-[44px] items-center gap-3 rounded-sm px-3 py-2.5 text-body transition-colors',
      isActive ? 'sidebar-active text-white' : 'text-ink-400 hover:bg-white/5 hover:text-white',
    );

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

      <nav className="flex-1 overflow-y-auto py-4">
        {isPlatformAdmin ? (
          <>
            <p className="px-6 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Admin
            </p>
            <ul className="space-y-0.5 px-3">
              <li>
                <Link
                  href="/platform-admin"
                  className={linkClass(pathname.startsWith('/platform-admin'))}
                >
                  <span
                    className={
                      pathname.startsWith('/platform-admin') ? 'text-white' : 'text-ink-500'
                    }
                  >
                    <ShieldCheck size={18} />
                  </span>
                  <span className="flex-1">Platform admin</span>
                </Link>
              </li>
            </ul>
          </>
        ) : (
          <ul className="space-y-0.5 px-3">
            {itemsWithBadges.map((item) => {
              // '/crm' must not light up for every practice page beneath it.
              const isActive =
                item.href === '/crm' ? pathname === '/crm' : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} className={linkClass(isActive)}>
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
        )}
      </nav>

      {/* Org settings, at the bottom of the main board. A platform admin
          administers the platform, not an organisation, so it is not theirs. */}
      {!isPlatformAdmin && (
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
      )}
    </aside>
  );
}
