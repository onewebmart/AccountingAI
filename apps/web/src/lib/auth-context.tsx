'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, setTokens, clearTokens, ApiError } from './api';

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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
      setTokens(res.tokens.accessToken, res.tokens.refreshToken);
      await fetchMe();
    }
    return {};
  }, [fetchMe]);

  const loginTotp = useCallback(async (tempToken: string, code: string) => {
    const res = await api.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      '/auth/login/totp',
      { tempToken, code },
    );
    setTokens(res.tokens.accessToken, res.tokens.refreshToken);
    await fetchMe();
  }, [fetchMe]);

  const signup = useCallback(async (name: string, email: string, password: string, businessName: string) => {
    const res = await api.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      '/auth/signup',
      { name, email, password, businessName },
    );
    setTokens(res.tokens.accessToken, res.tokens.refreshToken);
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clearTokens();
    setUser(null);
    router.push('/auth/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginTotp, signup, logout }}>
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
