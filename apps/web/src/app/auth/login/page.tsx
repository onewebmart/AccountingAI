'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, ApiError } from '@/lib/auth-context';

export default function LoginPage() {
  const { login, loginTotp } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresTotp) {
        setTempToken(result.tempToken ?? null);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That email and password don\'t match. Try again or reset your password.');
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setError(null);
    setLoading(true);
    try {
      await loginTotp(tempToken, totpCode);
      router.push('/dashboard');
    } catch {
      setError('Invalid code. Check your authenticator app and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <span className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            ◆ <span className="text-saffron-600">Ai</span>Books
          </span>
        </div>

        <div className="rounded-lg border border-line-200 bg-surface-card shadow-e2 p-8">
          {!tempToken ? (
            <>
              <h1 className="text-h2 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                Welcome back
              </h1>
              <p className="text-body text-ink-500 mb-6">Sign in to your account.</p>

              <form className="space-y-5" onSubmit={handleLogin}>
                <Input type="email" label="Email" placeholder="you@example.com" autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} required />
                <Input type="password" label="Password" placeholder="••••••••" autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} required />

                {error && <p className="text-caption text-error-fg bg-error-bg border border-error-fg/20 rounded px-3 py-2">{error}</p>}

                <div className="flex items-center justify-end">
                  <Link href="/auth/forgot-password" className="text-caption text-saffron-600 hover:underline">
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-line-200" /></div>
                <div className="relative flex justify-center">
                  <span className="bg-surface-card px-3 text-caption text-ink-400">or</span>
                </div>
              </div>

              <a href="http://localhost:3001/api/v1/auth/google">
                <Button variant="secondary" className="w-full gap-2" type="button">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </Button>
              </a>
            </>
          ) : (
            <>
              <h1 className="text-h2 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                Enter your 6-digit code
              </h1>
              <p className="text-body text-ink-500 mb-6">From your authenticator app.</p>
              <form className="space-y-5" onSubmit={handleTotp}>
                <Input type="text" label="Code" placeholder="000000" inputMode="numeric" maxLength={6}
                  value={totpCode} onChange={e => setTotpCode(e.target.value)} required />
                {error && <p className="text-caption text-error-fg bg-error-bg border border-error-fg/20 rounded px-3 py-2">{error}</p>}
                <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                  {loading ? 'Verifying…' : 'Verify'}
                </Button>
              </form>
              <button onClick={() => setTempToken(null)} className="mt-4 text-caption text-ink-500 hover:underline w-full text-center">
                ← Back to login
              </button>
            </>
          )}
        </div>

        <p className="text-center text-body text-ink-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-saffron-600 hover:underline font-medium">Sign up free</Link>
        </p>
      </div>
    </div>
  );
}
