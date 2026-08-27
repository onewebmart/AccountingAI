'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';

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

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If an account exists for ${email}, a reset link is on its way. It expires in an hour.`}
        footer={
          <Link href="/auth/login" className="font-medium text-saffron-600 hover:underline">
            ← Back to sign in
          </Link>
        }
      >
        <div className="rounded-sm border border-success-fg/25 bg-success-bg px-4 py-3.5 text-body text-ink-700">
          Nothing arrived? Check spam, or try again in a minute — the link is sent once per request.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to set a new one."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/auth/login" className="font-medium text-saffron-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
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
          <p className="rounded-sm border border-error-fg/20 bg-error-bg px-3 py-2 text-caption text-error-fg">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthShell>
  );
}
