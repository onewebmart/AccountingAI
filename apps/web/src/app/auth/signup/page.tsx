'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, ApiError } from '@/lib/auth-context';
import { AuthShell } from '@/components/auth/auth-shell';

export default function SignupPage() {
  const { signup, user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Already signed in — creating a second account here would silently replace
  // the session they are holding.
  useEffect(() => {
    if (!authLoading && user) router.replace('/dashboard');
  }, [authLoading, user, router]);

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
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. No card needed."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-saffron-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <Input
          type="text"
          label="Your name"
          placeholder="Rahul Sharma"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
        <Input
          type="email"
          label="Email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          label="Password"
          placeholder="Min 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          required
        />
        <Input
          type="text"
          label="Business / organisation name"
          placeholder="Acme Traders Pvt. Ltd."
          value={businessName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessName(e.target.value)}
          required
        />

        {error && (
          <p className="rounded-sm border border-error-fg/20 bg-error-bg px-3 py-2 text-caption text-error-fg">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-4 text-center text-caption text-ink-400">
        By signing up you agree to our Terms of Service and Privacy Policy.
      </p>
    </AuthShell>
  );
}
