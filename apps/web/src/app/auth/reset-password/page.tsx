'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

/** Matches the API's MinLength(8) so the rule is stated before the round trip. */
const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Those two passwords don’t match.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      // Resetting revokes every existing session, so there is nothing to
      // adopt here — they sign in fresh with the new password.
      router.replace('/auth/login?reason=password-reset');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reset the password. Request a new link and try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-line-200 bg-surface-card shadow-e2 p-8">
      {!token ? (
        <>
          <h1
            className="text-h2 font-display text-ink-900 mb-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            This link is incomplete
          </h1>
          <p className="text-body text-ink-500 mb-6">
            Open the link from your email exactly as it was sent, or request a new one.
          </p>
          <Button variant="primary" className="w-full" asChild>
            <Link href="/auth/forgot-password">Request a new link</Link>
          </Button>
        </>
      ) : (
        <>
          <h1
            className="text-h2 font-display text-ink-900 mb-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Set a new password
          </h1>
          <p className="text-body text-ink-500 mb-6">
            Signing in on your other devices will need this new password.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <Input
              type="password"
              label="New password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              type="password"
              label="Confirm new password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />

            {error && (
              <p className="text-caption text-error-fg bg-error-bg border border-error-fg/20 rounded px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <span
            className="text-h2 font-display text-ink-900"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            ◆ <span className="text-saffron-600">Ai</span>Books
          </span>
        </div>

        <Suspense
          fallback={
            <div className="rounded-lg border border-line-200 bg-surface-card shadow-e2 p-8">
              <p className="text-body text-ink-500">Loading…</p>
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>

        <p className="text-center text-body text-ink-500 mt-6">
          <Link href="/auth/login" className="text-saffron-600 hover:underline font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
