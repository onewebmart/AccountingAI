'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  CheckSquare,
  UserCheck,
  Package,
  TrendingUp,
  ShoppingBag,
  Timer,
  Building2,
  UserCog,
  ReceiptIndianRupee,
  BarChart3,
  FolderOpen,
  Briefcase,
  Target,
  Palette,
  ShieldCheck,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
  /** A quick "new" button beside the item, as for customers and vendors. */
  create?: string;
}

interface NavEntry {
  label: string;
  icon: React.ReactNode;
  /** A single page… */
  href?: string;
  /** …or a group of them, opened and closed from its heading. */
  items?: NavLink[];
  /** Other pages reached from a single page, which light it up too: /stock from Items. */
  also?: string[];
  /** Practice entries appear only once the org has a firm. */
  practice?: boolean;
}

/**
 * The main board: a few pages on their own, then the work grouped by area,
 * each area a list of its modules. The order follows the work: what comes in,
 * what you sell and buy, the bank, the accountant's adjustments, tax, and
 * what you read back.
 */
const NAV: NavEntry[] = [
  { label: 'Home', icon: <LayoutDashboard size={18} />, href: '/dashboard' },
  { label: 'Inbox', icon: <Inbox size={18} />, href: '/inbox' },
  { label: 'Review', icon: <CheckSquare size={18} />, href: '/review' },
  { label: 'Approvals', icon: <UserCheck size={18} />, href: '/approvals' },
  // Stock is a tab on the Items page.
  { label: 'Items', icon: <Package size={18} />, href: '/items', also: ['/stock'] },
  {
    label: 'Sales',
    icon: <TrendingUp size={18} />,
    items: [
      { href: '/sales/customers', label: 'Customers', create: '/sales/customers/new' },
      { href: '/sales/quotes', label: 'Quotes' },
      { href: '/sales/orders', label: 'Sales Orders' },
      { href: '/sales/invoices', label: 'Invoices' },
      { href: '/sales/recurring-invoices', label: 'Recurring Invoices' },
      { href: '/sales/challans', label: 'Delivery Challans' },
      { href: '/sales/payments-received', label: 'Payments Received' },
      { href: '/sales/credit-notes', label: 'Credit Notes' },
    ],
  },
  {
    label: 'Purchases',
    icon: <ShoppingBag size={18} />,
    items: [
      { href: '/purchases/vendors', label: 'Vendors', create: '/purchases/vendors/new' },
      { href: '/purchases/expenses', label: 'Expenses' },
      { href: '/purchases/recurring-expenses', label: 'Recurring Expenses' },
      { href: '/purchases/orders', label: 'Purchase Orders' },
      { href: '/purchases/bills', label: 'Bills' },
      { href: '/purchases/recurring-bills', label: 'Recurring Bills' },
      { href: '/purchases/payments-made', label: 'Payments Made' },
      { href: '/purchases/payment-runs', label: 'Payment Runs' },
      { href: '/purchases/vendor-credits', label: 'Vendor Credits' },
      { href: '/purchases/claims', label: 'Employee Claims' },
    ],
  },
  {
    label: 'Time Tracking',
    icon: <Timer size={18} />,
    items: [
      { href: '/time/projects', label: 'Projects' },
      { href: '/time/timesheet', label: 'Timesheet' },
    ],
  },
  { label: 'Banking', icon: <Building2 size={18} />, href: '/banking' },
  {
    label: 'Accountant',
    icon: <UserCog size={18} />,
    items: [
      { href: '/accountant/manual-journals', label: 'Manual Journals' },
      { href: '/accountant/bulk-update', label: 'Bulk Update' },
      { href: '/accountant/currency-adjustments', label: 'Currency Adjustments' },
      { href: '/accountant/chart-of-accounts', label: 'Chart of Accounts' },
      { href: '/accountant/budgets', label: 'Budgets' },
      { href: '/accountant/transaction-locking', label: 'Transaction Locking' },
      { href: '/month-end', label: 'Month-end' },
      { href: '/migration', label: 'Opening Balances' },
      { href: '/vouchers', label: 'All Vouchers' },
      { href: '/currency', label: 'Foreign Currency' },
    ],
  },
  {
    label: 'Taxes',
    icon: <ReceiptIndianRupee size={18} />,
    items: [
      { href: '/gst', label: 'GST' },
      { href: '/tds', label: 'TDS' },
    ],
  },
  {
    label: 'Reports',
    icon: <BarChart3 size={18} />,
    items: [
      { href: '/reports', label: 'Reports' },
      { href: '/reports/management', label: 'Management Reports' },
      { href: '/insights', label: 'Insights' },
      { href: '/audit', label: 'Audit Trail' },
    ],
  },
  { label: 'Documents', icon: <FolderOpen size={18} />, href: '/documents' },
  {
    label: 'Practice',
    icon: <Briefcase size={18} />,
    practice: true,
    items: [
      { href: '/crm', label: 'Practice home' },
      { href: '/crm/clients', label: 'Clients' },
      { href: '/crm/compliance', label: 'Compliance' },
      { href: '/crm/documents', label: 'Document hub' },
      { href: '/crm/tasks', label: 'Tasks' },
    ],
  },
  {
    label: 'Growth & fees',
    icon: <Target size={18} />,
    practice: true,
    items: [
      { href: '/crm/leads', label: 'Leads' },
      { href: '/crm/invoices', label: 'Fees' },
      { href: '/crm/agent', label: 'Support agent' },
      { href: '/crm/settings', label: 'Messaging' },
    ],
  },
  {
    label: 'Firm',
    icon: <Palette size={18} />,
    practice: true,
    items: [
      { href: '/crm/reports', label: 'Practice reports' },
      // The only route to white-label branding and the client portal domain.
      { href: '/firm-portal', label: 'Firm & branding' },
    ],
  },
];

/** Shown in place of the practice groups when the org has no firm yet. */
const PRACTICE_SETUP: NavEntry = { label: 'Set up practice', icon: <Briefcase size={18} />, href: '/crm' };

const OPEN_KEY = 'aibooks.sidebar.open';

/**
 * The one item a path belongs to: the longest href it starts with. An entry's
 * `also` paths count as its own (/stock lights up Items).
 */
function activeHrefFor(pathname: string, hrefs: string[], aliases: Array<[string, string]> = []): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [prefix, h] of [...hrefs.map((h): [string, string] => [h, h]), ...aliases]) {
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
      best = h;
      bestLength = prefix.length;
    }
  }
  return best;
}

interface SidebarProps {
  inboxCount?: number;
  reviewCount?: number;
  /** The practice this org runs, when it has one. */
  firmName?: string;
  /** A platform admin runs the platform and has no books: the admin board alone. */
  role?: string;
  /** Below lg the sidebar is a drawer: open or not, and how to close it. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ inboxCount = 0, reviewCount = 0, firmName, role, open: drawerOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isPlatformAdmin = role === 'PLATFORM_SUPER_ADMIN';
  const entries = useMemo(
    () => (isPlatformAdmin ? [] : firmName ? NAV : [...NAV.filter((e) => !e.practice), PRACTICE_SETUP]),
    [isPlatformAdmin, firmName],
  );
  const allHrefs = useMemo(() => entries.flatMap((e) => (e.href ? [e.href] : (e.items ?? []).map((i) => i.href))), [entries]);
  const aliases = useMemo(() => entries.flatMap((e) => (e.href ? (e.also ?? []).map((p): [string, string] => [p, e.href!]) : [])), [entries]);
  const active = activeHrefFor(pathname, allHrefs, aliases);
  const activeGroup = entries.find((e) => e.items?.some((i) => i.href === active))?.label ?? null;

  // Groups the person opened stay open between visits; the one in use always is.
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
      if (Array.isArray(saved)) setOpen(new Set(saved.filter((s): s is string => typeof s === 'string')));
    } catch {
      // Storage may be unavailable; groups then start closed.
    }
  }, []);
  const toggle = (label: string) => {
    setOpen((cur) => {
      const nextOpen = new Set(cur);
      if (nextOpen.has(label)) nextOpen.delete(label);
      else nextOpen.add(label);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...nextOpen]));
      } catch {
        // Not remembered, but still toggled.
      }
      return nextOpen;
    });
  };

  const badgeFor = (href: string) => (href === '/inbox' && inboxCount > 0 ? inboxCount : href === '/review' && reviewCount > 0 ? reviewCount : undefined);

  const topClass = (isActive: boolean) =>
    cn('flex min-h-[40px] w-full items-center gap-3 rounded-md px-3 py-2 text-body font-medium transition-colors', isActive ? 'sidebar-active text-white' : 'text-navy-200 hover:bg-white/[0.06] hover:text-white');

  return (
    <>
    {/* Below lg: a scrim behind the open drawer; a tap on it closes the drawer. */}
    {drawerOpen && <div className="fixed inset-0 z-[45] bg-navy-950/50 backdrop-blur-[1px] lg:hidden" onClick={onClose} aria-hidden />}
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col bg-navy-900 transition-transform duration-200 ease-out lg:z-40 lg:translate-x-0',
        drawerOpen ? 'translate-x-0 shadow-e3' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-heading text-[0.8125rem] font-extrabold text-white shadow-e1">Ai</span>
          <span className="font-heading text-h3 font-bold tracking-tight text-white">AiBooks</span>
        </Link>
        <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-navy-200 hover:bg-white/10 hover:text-white lg:hidden">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        {isPlatformAdmin ? (
          <Link href="/platform-admin" className={topClass(pathname.startsWith('/platform-admin'))}>
            <ShieldCheck size={18} className={pathname.startsWith('/platform-admin') ? 'text-white' : 'text-navy-300'} />
            <span className="flex-1">Platform admin</span>
          </Link>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((entry) => {
              if (entry.href) {
                const isActive = active === entry.href;
                const badge = badgeFor(entry.href);
                return (
                  <li key={entry.label}>
                    <Link href={entry.href} className={topClass(isActive)}>
                      <span className={isActive ? 'text-brand-400' : 'text-navy-300'}>{entry.icon}</span>
                      <span className="flex-1">{entry.label}</span>
                      {badge !== undefined && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-marigold-400 px-1.5 text-[0.75rem] font-semibold text-ink-900">{badge}</span>
                      )}
                    </Link>
                  </li>
                );
              }
              const isOpen = open.has(entry.label) || activeGroup === entry.label;
              const inGroup = activeGroup === entry.label;
              return (
                <li key={entry.label}>
                  <button type="button" onClick={() => toggle(entry.label)} aria-expanded={isOpen} className={cn(topClass(false), inGroup && 'text-white')}>
                    <span className={inGroup ? 'text-brand-400' : 'text-navy-300'}>{entry.icon}</span>
                    <span className="flex-1 text-left">{entry.label}</span>
                    {isOpen ? <ChevronDown size={14} className="text-navy-300" /> : <ChevronRight size={14} className="text-navy-300" />}
                  </button>
                  {isOpen && (
                    <ul className="mb-1 mt-0.5 space-y-0.5">
                      {(entry.items ?? []).map((item) => {
                        const isActive = active === item.href;
                        return (
                          <li key={item.href} className="group relative">
                            <Link
                              href={item.href}
                              className={cn(
                                'flex min-h-[34px] items-center rounded-md py-1.5 pl-11 pr-9 text-[0.875rem] transition-colors',
                                isActive ? 'sidebar-active font-medium text-white' : 'text-navy-200/90 hover:bg-white/[0.06] hover:text-white',
                              )}
                            >
                              {item.label}
                            </Link>
                            {item.create && (
                              <Link
                                href={item.create}
                                aria-label={`New ${item.label.replace(/s$/, '').toLowerCase()}`}
                                title={`New ${item.label.replace(/s$/, '').toLowerCase()}`}
                                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-white/10 text-white hover:bg-brand-600"
                              >
                                <Plus size={14} />
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {!isPlatformAdmin && (
        <div className="border-t border-white/10 p-3">
          <Link href="/settings" className={topClass(pathname.startsWith('/settings'))}>
            <Settings size={18} className={pathname.startsWith('/settings') ? 'text-brand-400' : 'text-navy-300'} />
            <span>Settings</span>
          </Link>
        </div>
      )}
    </aside>
    </>
  );
}
