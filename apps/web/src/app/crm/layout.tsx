'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CrmSidebar } from '@/components/crm/crm-sidebar';
import { PageTransition } from '@/components/motion/page-transition';
import { useAuth } from '@/lib/auth-context';

/**
 * CRM workspace shell.
 *
 * Deliberately a sibling of the (app) group rather than a child: (app) is the
 * bookkeeping app for a single org, while the CRM is the CA firm's practice
 * management across its whole client book. Nesting them would stack two sidebars.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-page">
        <span className="text-ink-500">Loading…</span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface-page">
      <CrmSidebar firmName="Your firm" />
      <main className="ml-[260px]">
        <div className="mx-auto max-w-content px-6 py-8">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
