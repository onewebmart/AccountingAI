'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/use-workspace';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // Badge counts come from the same call that names the org, so the sidebar
  // can never disagree with the page beside it.
  const { data: workspace } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <span className="text-body text-ink-500">Loading…</span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface-page">
      <Sidebar
        inboxCount={workspace?.counts.inbox ?? 0}
        reviewCount={workspace?.counts.review ?? 0}
        firmName={workspace?.firm?.name}
      />
      <Topbar />
      <main className="ml-[260px] pt-16">
        <div className="mx-auto max-w-content px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
