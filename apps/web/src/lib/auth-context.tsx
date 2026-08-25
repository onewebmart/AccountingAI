'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, setTokens, clearTokens, onSessionEnded, resetSessionEnded, ApiError } from './api';

interface AuthUser {
  userId: string;
  email: string;
  orgId: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTotp?: boolean; tempToken?: string }>;
  loginTotp: (tempToken: string, code: string) => Promise<void>;
  signup: (name: string, email: string, password: string, businessName: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Adopts tokens minted elsewhere (the Google OAuth redirect). */
  adoptSession: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Re-reads the session — call after anything that changes role or firm. */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Routes that render without a session; an expiry here needs no redirect.
 *
 * Onboarding is deliberately absent — it posts to authenticated endpoints, so
 * a lapse there has to reach the sign-in page like anywhere else.
 */
const PUBLIC_PREFIXES = ['/auth'];

function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Read inside the listener so it can stay subscribed for the app's lifetime
  // instead of resubscribing on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.get<AuthUser>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      fetchMe();
    } else {
      setLoading(false);
    }
  }, [fetchMe]);

  /**
   * The API client detected that the session is over — its refresh token was
   * rejected or gone. Tear the session down here, once, rather than letting
   * each screen surface its own failure while the shell still looks signed in.
   */
  useEffect(() => {
    return onSessionEnded(({ hadSession }) => {
      setUser(null);
      setLoading(false);
      queryClient.clear();

      const current = pathnameRef.current;
      if (isPublicPath(current)) return;

      // Remember where they were so signing in returns them to it.
      const next = `next=${encodeURIComponent(current)}`;
      router.replace(
        hadSession ? `/auth/login?reason=expired&${next}` : `/auth/login?${next}`,
      );
    });
  }, [router, queryClient]);

  const startSession = useCallback(
    async (tokens: { accessToken: string; refreshToken: string }) => {
      setTokens(tokens.accessToken, tokens.refreshToken);
      resetSessionEnded();
      // Nothing in the cache belongs to this session yet, and whatever is
      // there belongs to whoever was signed in before.
      queryClient.clear();
      await fetchMe();
    },
    [fetchMe, queryClient],
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{
      requiresTotp?: boolean;
      tempToken?: string;
      tokens?: { accessToken: string; refreshToken: string };
      user?: AuthUser;
    }>('/auth/login', { email, password });

    if (res.requiresTotp) {
      return { requiresTotp: true, tempToken: res.tempToken };
    }
    if (res.tokens) {
      await startSession(res.tokens);
    }
    return {};
  }, [startSession]);

  const loginTotp = useCallback(async (tempToken: string, code: string) => {
    const res = await api.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      '/auth/login/totp',
      { tempToken, code },
    );
    await startSession(res.tokens);
  }, [startSession]);

  const signup = useCallback(
    async (name: string, email: string, password: string, businessName: string) => {
      const res = await api.post<{ tokens: { accessToken: string; refreshToken: string } }>(
        '/auth/signup',
        { name, email, password, businessName },
      );
      await startSession(res.tokens);
    },
    [startSession],
  );

  const adoptSession = useCallback(
    async (accessToken: string, refreshToken: string) => {
      await startSession({ accessToken, refreshToken });
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    // Revoke the refresh token server-side first, while the access token that
    // authorises the call is still held.
    try { await api.post('/auth/logout'); } catch { /* signing out locally regardless */ }
    clearTokens();
    resetSessionEnded();
    setUser(null);
    // Otherwise the next person to sign in on this browser sees the previous
    // org's figures for as long as the cache stays warm.
    queryClient.clear();
    router.replace('/');
  }, [router, queryClient]);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, loginTotp, signup, logout, adoptSession, reload: fetchMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export { ApiError };
