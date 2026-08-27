'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';

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

  if (!token) {
    return (
      <AuthShell
        title="This link is incomplete"
        subtitle="Open the link from your email exactly as it was sent, or request a new one."
        footer={
          <Link href="/auth/login" className="font-medium text-saffron-600 hover:underline">
            ← Back to sign in
          </Link>
        }
      >
        <Button variant="primary" className="w-full" asChild>
          <Link href="/auth/forgot-password">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Signing in on your other devices will need this new password."
      footer={
        <Link href="/auth/login" className="font-medium text-saffron-600 hover:underline">
          ← Back to sign in
        </Link>
      }
    >
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
          <p className="rounded-sm border border-error-fg/20 bg-error-bg px-3 py-2 text-caption text-error-fg">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-surface-page">
          <p className="text-body text-ink-500">Loading…</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
