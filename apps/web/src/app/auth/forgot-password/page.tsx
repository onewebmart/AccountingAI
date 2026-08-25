'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      // The endpoint answers the same way whether or not the address is
      // registered, so a failure here is the network or the server — never a
      // hint about who has an account.
      setError(
        err instanceof ApiError && err.isOffline
          ? err.message
          : 'Could not send the reset link. Try again in a moment.',
      );
    } finally {
      setLoading(false);
    }
  };

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

        <div className="rounded-lg border border-line-200 bg-surface-card shadow-e2 p-8">
          {sent ? (
            <>
              <h1
                className="text-h2 font-display text-ink-900 mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Check your email
              </h1>
              <p className="text-body text-ink-500 mb-6">
                If an account exists for <span className="text-ink-900">{email}</span>, a reset link
                is on its way. It expires in an hour.
              </p>
              <Button variant="secondary" className="w-full" asChild>
                <Link href="/auth/login">Back to sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <h1
                className="text-h2 font-display text-ink-900 mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Reset your password
              </h1>
              <p className="text-body text-ink-500 mb-6">
                Enter your email and we&apos;ll send you a link to set a new one.
              </p>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <Input
                  type="email"
                  label="Email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />

                {error && (
                  <p className="text-caption text-error-fg bg-error-bg border border-error-fg/20 rounded px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-body text-ink-500 mt-6">
          Remembered it?{' '}
          <Link href="/auth/login" className="text-saffron-600 hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
