'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, ApiError } from '@/lib/auth-context';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signup(name, email, password, businessName);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center px-4">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <span className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            ◆ <span className="text-saffron-600">Ai</span>Books
          </span>
        </div>

        <div className="rounded-lg border border-line-200 bg-surface-card shadow-e2 p-8">
          <h1 className="text-h2 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Create your account
          </h1>
          <p className="text-body text-ink-500 mb-6">Free to start. No card needed.</p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <Input type="text" label="Your name" placeholder="Rahul Sharma"
              value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} required />
            <Input type="email" label="Email" placeholder="you@example.com" autoComplete="email"
              value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required />
            <Input type="password" label="Password" placeholder="Min 8 characters" autoComplete="new-password"
              value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
            <Input type="text" label="Business / organisation name" placeholder="Acme Traders Pvt. Ltd."
              value={businessName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessName(e.target.value)} required />

            {error && <p className="text-caption text-error-fg bg-error-bg border border-error-fg/20 rounded px-3 py-2">{error}</p>}

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="text-caption text-ink-400 text-center mt-4">
            By signing up you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>

        <p className="text-center text-body text-ink-500 mt-6">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-saffron-600 hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
