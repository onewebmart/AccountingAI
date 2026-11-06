'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SIDEBAR_WIDTH } from './use-sidebar-layout';

interface NavLink {
  href: string;
  label: string;
  /** Its "new" page: a + appears beside the item on hover. */
  create?: string;
}

interface NavEntry {
  label: string;
  icon: React.ReactNode;
  /** A single page… */
  href?: string;
  /** …with its own "new" page, for the + on hover. */
  create?: string;
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
 * what you read back. Everything that can be made new has a + on hover.
 */
const NAV: NavEntry[] = [
  { label: 'Home', icon: <LayoutDashboard size={18} />, href: '/dashboard' },
  { label: 'Inbox', icon: <Inbox size={18} />, href: '/inbox' },
  { label: 'Review', icon: <CheckSquare size={18} />, href: '/review' },
  { label: 'Approvals', icon: <UserCheck size={18} />, href: '/approvals' },
  // Stock is a tab on the Items page.
  { label: 'Items', icon: <Package size={18} />, href: '/items', create: '/items/new', also: ['/stock'] },
  {
    label: 'Sales',
    icon: <TrendingUp size={18} />,
    items: [
      { href: '/sales/customers', label: 'Customers', create: '/sales/customers/new' },
      { href: '/sales/quotes', label: 'Quotes', create: '/sales/quotes/new' },
      { href: '/sales/orders', label: 'Sales Orders', create: '/sales/orders/new' },
      { href: '/sales/invoices', label: 'Invoices', create: '/sales/invoices/new' },
      { href: '/sales/recurring-invoices', label: 'Recurring Invoices', create: '/sales/recurring-invoices/new' },
      { href: '/sales/challans', label: 'Delivery Challans', create: '/sales/challans/new' },
      { href: '/sales/payments-received', label: 'Payments Received', create: '/sales/payments-received/new' },
      { href: '/sales/credit-notes', label: 'Credit Notes', create: '/sales/credit-notes/new' },
    ],
  },
  {
    label: 'Purchases',
    icon: <ShoppingBag size={18} />,
    items: [
      { href: '/purchases/vendors', label: 'Vendors', create: '/purchases/vendors/new' },
      { href: '/purchases/expenses', label: 'Expenses', create: '/purchases/expenses/new' },
      { href: '/purchases/recurring-expenses', label: 'Recurring Expenses', create: '/purchases/recurring-expenses/new' },
      { href: '/purchases/orders', label: 'Purchase Orders', create: '/purchases/orders/new' },
      { href: '/purchases/bills', label: 'Bills', create: '/purchases/bills/new' },
      { href: '/purchases/recurring-bills', label: 'Recurring Bills', create: '/purchases/recurring-bills/new' },
      { href: '/purchases/payments-made', label: 'Payments Made', create: '/purchases/payments-made/new' },
      { href: '/purchases/payment-runs', label: 'Payment Runs' },
      { href: '/purchases/vendor-credits', label: 'Vendor Credits', create: '/purchases/vendor-credits/new' },
      { href: '/purchases/claims', label: 'Employee Claims', create: '/purchases/claims/new' },
    ],
  },
  {
    label: 'Time Tracking',
    icon: <Timer size={18} />,
    items: [
      { href: '/time/projects', label: 'Projects', create: '/time/projects/new' },
      { href: '/time/timesheet', label: 'Timesheet' },
    ],
  },
  { label: 'Banking', icon: <Building2 size={18} />, href: '/banking' },
  {
    label: 'Accountant',
    icon: <UserCog size={18} />,
    items: [
      { href: '/accountant/manual-journals', label: 'Manual Journals', create: '/accountant/manual-journals/new' },
      { href: '/accountant/bulk-update', label: 'Bulk Update' },
      { href: '/accountant/currency-adjustments', label: 'Currency Adjustments', create: '/accountant/currency-adjustments/new' },
      { href: '/accountant/chart-of-accounts', label: 'Chart of Accounts', create: '/accountant/chart-of-accounts/new' },
      { href: '/accountant/budgets', label: 'Budgets', create: '/accountant/budgets/new' },
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
      { href: '/reports', label: 'Reports', create: '/reports/new' },
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

/** "New invoice" from "Invoices", "New payment received" from "Payments Received". */
function newLabel(label: string): string {
  const singular = label
    .replace(/ies$/, 'y')
    .replace(/(Orders|Notes|Credits|Claims|Challans|Invoices|Bills|Expenses|Quotes|Projects|Budgets|Journals|Adjustments|Customers|Vendors|Items|Reports)$/, (w) => w.slice(0, -1))
    .replace(/Payments Received$/, 'Payment Received')
    .replace(/Payments Made$/, 'Payment Made')
    .replace(/Chart of Accounts$/, 'Account');
  return `New ${singular.toLowerCase()}`;
}

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

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

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
  /** On a desktop: folded to an icon rail, and the width when it is not. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  width?: number;
  /** While dragging: `remember` is false until the pointer is let go. */
  onWidthChange?: (width: number, remember?: boolean) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

export function Sidebar({
  inboxCount = 0,
  reviewCount = 0,
  firmName,
  role,
  open: drawerOpen = false,
  onClose,
  collapsed = false,
  onCollapsedChange,
  width = SIDEBAR_WIDTH.standard,
  onWidthChange,
  onDraggingChange,
}: SidebarProps) {
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
  const setGroup = (label: string, to?: boolean) => {
    setOpen((cur) => {
      const nextOpen = new Set(cur);
      const want = to ?? !nextOpen.has(label);
      if (want) nextOpen.add(label);
      else nextOpen.delete(label);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...nextOpen]));
      } catch {
        // Not remembered, but still toggled.
      }
      return nextOpen;
    });
  };

  // Folded to icons: on a desktop only. In the phone drawer every label shows.
  const rail = collapsed;
  /** Hidden on the desktop rail, shown in the drawer. */
  const railHide = rail ? 'lg:hidden' : '';

  const badgeFor = (href: string) => (href === '/inbox' && inboxCount > 0 ? inboxCount : href === '/review' && reviewCount > 0 ? reviewCount : undefined);

  const topClass = (isActive: boolean) =>
    cn(
      'flex min-h-[40px] w-full items-center gap-3 rounded-md px-3 py-2 text-body font-medium transition-colors',
      rail && 'lg:justify-center lg:px-0',
      isActive ? 'sidebar-active text-white' : 'text-navy-200 hover:bg-white/[0.06] hover:text-white',
    );

  // ── Dragging the right edge sets the width ──
  const startX = useRef(0);
  const startW = useRef(width);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rail) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startW.current = width;
    onDraggingChange?.(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onWidthChange?.(startW.current + e.clientX - startX.current, false);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onWidthChange?.(startW.current + e.clientX - startX.current, true);
    onDraggingChange?.(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') onWidthChange?.(width - step);
    else if (e.key === 'ArrowRight') onWidthChange?.(width + step);
    else if (e.key === 'Home') onWidthChange?.(SIDEBAR_WIDTH.min);
    else if (e.key === 'End') onWidthChange?.(SIDEBAR_WIDTH.max);
    else return;
    e.preventDefault();
  };

  /** The + beside an item: on hover (or keyboard focus) only, so the list stays quiet. */
  const plus = (href: string, label: string, extra?: string) => (
    <Link
      href={href}
      aria-label={newLabel(label)}
      title={newLabel(label)}
      className={cn(
        'absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-white/10 text-white opacity-0 transition-opacity hover:bg-brand-600 focus-visible:opacity-100 group-hover:opacity-100',
        extra,
      )}
    >
      <Plus size={14} />
    </Link>
  );

  return (
    <>
      {/* Below lg: a scrim behind the open drawer; a tap on it closes the drawer. */}
      {drawerOpen && <div className="fixed inset-0 z-[45] bg-navy-950/50 backdrop-blur-[1px] lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'group/sidebar fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col bg-navy-900 transition-[transform,width] duration-200 ease-out lg:z-40 lg:w-[var(--sidebar-w)] lg:translate-x-0',
          'group-data-[dragging=true]/shell:transition-none',
          drawerOpen ? 'translate-x-0 shadow-e3' : '-translate-x-full',
        )}
      >
        <div className={cn('flex h-16 items-center gap-2 border-b border-white/10 px-5', rail && 'lg:justify-center lg:px-0')}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-md" title="AiBooks">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 font-heading text-[0.8125rem] font-extrabold text-white shadow-e1">Ai</span>
            <span className={cn('truncate font-heading text-h3 font-bold tracking-tight text-white', railHide)}>AiBooks</span>
          </Link>
          <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-navy-200 hover:bg-white/10 hover:text-white lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden px-3 py-3', rail && 'lg:px-2')} aria-label="Main">
          {isPlatformAdmin ? (
            <Link href="/platform-admin" title="Platform admin" className={topClass(pathname.startsWith('/platform-admin'))}>
              <ShieldCheck size={18} className={pathname.startsWith('/platform-admin') ? 'text-white' : 'text-navy-300'} />
              <span className={cn('flex-1', railHide)}>Platform admin</span>
            </Link>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((entry) => {
                if (entry.href) {
                  const isActive = active === entry.href;
                  const badge = badgeFor(entry.href);
                  return (
                    <li key={entry.label} className="group relative">
                      <Link href={entry.href} title={rail ? entry.label : undefined} className={cn(topClass(isActive), entry.create && !rail && 'pr-9')}>
                        <span className={cn('relative', isActive ? 'text-brand-400' : 'text-navy-300')}>
                          {entry.icon}
                          {/* On the rail a count becomes a dot on the icon. */}
                          {badge !== undefined && rail && <span className="absolute -right-1 -top-1 hidden h-2 w-2 rounded-full bg-marigold-400 ring-2 ring-navy-900 lg:block" />}
                        </span>
                        <span className={cn('flex-1 truncate', railHide)}>{entry.label}</span>
                        {badge !== undefined && (
                          <span className={cn('flex h-5 min-w-[20px] items-center justify-center rounded-full bg-marigold-400 px-1.5 text-[0.75rem] font-semibold text-navy-950', railHide)}>{badge}</span>
                        )}
                      </Link>
                      {entry.create && plus(entry.create, entry.label, cn(badge !== undefined && 'hidden', railHide))}
                    </li>
                  );
                }
                const isOpen = open.has(entry.label) || activeGroup === entry.label;
                const inGroup = activeGroup === entry.label;
                return (
                  <li key={entry.label}>
                    <button
                      type="button"
                      title={rail ? entry.label : undefined}
                      onClick={() => {
                        // On the rail a group opens the sidebar with that group showing.
                        if (rail && isDesktop()) {
                          onCollapsedChange?.(false);
                          setGroup(entry.label, true);
                          return;
                        }
                        setGroup(entry.label);
                      }}
                      aria-expanded={isOpen}
                      className={cn(topClass(false), inGroup && 'text-white', rail && inGroup && 'lg:bg-white/[0.06]')}
                    >
                      <span className={inGroup ? 'text-brand-400' : 'text-navy-300'}>{entry.icon}</span>
                      <span className={cn('flex-1 truncate text-left', railHide)}>{entry.label}</span>
                      <span className={railHide}>{isOpen ? <ChevronDown size={14} className="text-navy-300" /> : <ChevronRight size={14} className="text-navy-300" />}</span>
                    </button>
                    {isOpen && (
                      <ul className={cn('mb-1 mt-0.5 space-y-0.5', railHide)}>
                        {(entry.items ?? []).map((item) => {
                          const isActive = active === item.href;
                          return (
                            <li key={item.href} className="group relative">
                              <Link
                                href={item.href}
                                className={cn(
                                  'flex min-h-[34px] items-center truncate rounded-md py-1.5 pl-11 pr-9 text-[0.875rem] transition-colors',
                                  isActive ? 'sidebar-active font-medium text-white' : 'text-navy-200/90 hover:bg-white/[0.06] hover:text-white',
                                )}
                              >
                                {item.label}
                              </Link>
                              {item.create && plus(item.create, item.label)}
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
          <div className={cn('space-y-0.5 border-t border-white/10 p-3', rail && 'lg:px-2')}>
            <Link href="/settings" title={rail ? 'Settings' : undefined} className={topClass(pathname.startsWith('/settings'))}>
              <Settings size={18} className={pathname.startsWith('/settings') ? 'text-brand-400' : 'text-navy-300'} />
              <span className={railHide}>Settings</span>
            </Link>
            {/* Desktop only: fold the sidebar to icons, or open it again. */}
            <button
              type="button"
              onClick={() => onCollapsedChange?.(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(topClass(false), 'hidden lg:flex')}
            >
              {collapsed ? <PanelLeftOpen size={18} className="text-navy-300" /> : <PanelLeftClose size={18} className="text-navy-300" />}
              <span className={railHide}>Collapse</span>
            </button>
          </div>
        )}

        {/* The right edge: drag to set the width, double-click for the standard one. Desktop, open sidebar only. */}
        {!rail && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_WIDTH.min}
            aria-valuemax={SIDEBAR_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            title="Drag to resize; double-click to reset"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => onWidthChange?.(SIDEBAR_WIDTH.standard)}
            onKeyDown={onResizeKey}
            className="absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize lg:block after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-brand-500 focus-visible:outline-none focus-visible:after:bg-brand-500 group-data-[dragging=true]/shell:after:bg-brand-500"
          />
        )}
      </aside>
    </>
  );
}
