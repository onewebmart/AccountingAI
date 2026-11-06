'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useSidebarLayout } from '@/components/shell/use-sidebar-layout';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/use-workspace';
import { PageTransition } from '@/components/motion/page-transition';
import { Notifier } from '@/components/page/notifier';
import { AskAssistant } from '@/components/assistant/ask-assistant';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // Badge counts come from the same call that names the org, so the sidebar
  // can never disagree with the page beside it.
  const { data: workspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  // Below lg the sidebar is a drawer; it closes when the page changes.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  // On a desktop: how wide the sidebar is, or folded to icons. Shared as --sidebar-w.
  const sidebar = useSidebarLayout();

  useEffect(() => {
    if (!loading && !user) {
      // Carry the destination through the sign-in so an expired session
      // returns to the page it interrupted rather than to the dashboard.
      router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <span className="text-body text-ink-500">Loading…</span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="group/shell min-h-screen bg-surface-page"
      // The sidebar, topbar, page and bottom form bars all leave this much room on a desktop.
      style={{ ['--sidebar-w' as string]: `${sidebar.current}px` }}
      data-dragging={sidebar.dragging ? 'true' : undefined}
    >
      <Sidebar
        inboxCount={workspace?.counts.inbox ?? 0}
        reviewCount={workspace?.counts.review ?? 0}
        firmName={workspace?.firm?.name}
        role={workspace?.user.role}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        collapsed={sidebar.collapsed}
        onCollapsedChange={sidebar.setCollapsed}
        width={sidebar.width}
        onWidthChange={sidebar.setWidth}
        onDraggingChange={sidebar.setDragging}
      />
      <Topbar onMenu={() => setNavOpen(true)} />
      <main className="pt-16 transition-[margin] duration-200 ease-out group-data-[dragging=true]/shell:transition-none lg:ml-[var(--sidebar-w)]">
        {/* pb-28 lets the end of every page scroll clear of the Ask your books button. */}
        <div className="mx-auto max-w-content px-4 pb-28 pt-6 sm:px-6 sm:pt-8">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <Notifier />
      <AskAssistant />
    </div>
  );
}
