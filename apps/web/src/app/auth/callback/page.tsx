'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const { adoptSession } = useAuth();

  useEffect(() => {
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');

    if (!accessToken || !refreshToken) {
      router.replace('/auth/login?reason=oauth-failed');
      return;
    }

    // Storing the tokens is not enough: the provider mounted before they
    // existed, so it still holds a signed-out session and the dashboard would
    // bounce straight back here. Let it load the user before navigating.
    void adoptSession(accessToken, refreshToken).then(() => {
      router.replace('/dashboard');
    });
  }, [params, router, adoptSession]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <p className="text-body text-ink-500">Signing you in…</p>
      <Suspense>
        <CallbackHandler />
      </Suspense>
    </div>
  );
}
