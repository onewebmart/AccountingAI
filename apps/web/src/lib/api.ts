const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';

/**
 * Endpoints that establish a session rather than consume one.
 *
 * A 401 from these means "those credentials are wrong", not "your session
 * ended" — retrying them with a refreshed token is meaningless, and treating
 * a failed sign-in as an expiry would bounce the user off the login page they
 * are standing on.
 */
const SESSION_ENTRY_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/google'];

function isSessionEntry(path: string): boolean {
  return SESSION_ENTRY_PATHS.some((p) => path.startsWith(p));
}

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ─── Session expiry ─────────────────────────────────────────────────
//
// The API client is the only code that learns a session has ended — it is
// where the refresh fails. Without a way to say so, every screen kept
// rendering as if signed in and each action failed on its own with a bare
// "Unauthorized". Subscribers (the auth provider) turn that into one sign-out
// and one redirect.

type SessionEndedListener = (info: { hadSession: boolean }) => void;

const sessionEndedListeners = new Set<SessionEndedListener>();
let sessionEnded = false;

export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

function endSession() {
  // Distinguishes "your session expired" from "you were never signed in" —
  // telling a first-time visitor their session ran out is nonsense.
  const hadSession = typeof window !== 'undefined' && !!localStorage.getItem(ACCESS_KEY);
  clearTokens();
  // Several in-flight requests can fail together; announce it once.
  if (sessionEnded) return;
  sessionEnded = true;
  sessionEndedListeners.forEach((l) => l({ hadSession }));
}

/** Called after a successful sign-in so a later expiry announces itself again. */
export function resetSessionEnded() {
  sessionEnded = false;
}

// ─── Refresh ────────────────────────────────────────────────────────

/**
 * In-flight refresh, shared by every caller.
 *
 * Refresh tokens rotate: the server replaces the stored jti on each use, so
 * the second of two concurrent refreshes presents a token that is already
 * spent and is rejected. A dashboard fires a handful of queries at once, so
 * once the access token lapsed they would race and kill a session that was
 * still perfectly renewable. One shared promise means one rotation.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken =
      typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) {
      endSession();
      return null;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        endSession();
        return null;
      }
      // /auth/refresh returns the pair flat; /auth/login and /auth/signup nest
      // it under `tokens`. Accept either, so this cannot break again if one
      // endpoint's shape moves.
      const data = await res.json();
      const tokens = data.tokens ?? data;
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        endSession();
        return null;
      }
      setTokens(tokens.accessToken, tokens.refreshToken);
      return tokens.accessToken as string;
    } catch {
      // A network failure is not proof the session is gone — the server may
      // simply be down. Keep the tokens so the next attempt can succeed.
      return null;
    } finally {
      // Cleared in a microtask so callers awaiting this promise all observe
      // the same result before a new refresh can start.
      const settled = refreshInFlight;
      queueMicrotask(() => {
        if (refreshInFlight === settled) refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }

  /** True when the server was never reached. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    // fetch only rejects when the request never completed. Saying so beats
    // the generic failure text every caller would otherwise show.
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && !isSessionEntry(path)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      try {
        res = await fetch(`${API_BASE}${path}`, { ...init, headers });
      } catch {
        throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
      }
    }

    if (res.status === 401) {
      // Refresh could not save it — the session is over. The provider is
      // already redirecting; this message is what a mid-action screen shows
      // in the moment before it does.
      endSession();
      throw new ApiError(401, 'Your session expired. Sign in again to continue.');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
