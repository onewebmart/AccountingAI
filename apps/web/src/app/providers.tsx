'use client';

import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { useState } from 'react';

/**
 * Don't retry a request the server answered clearly.
 *
 * A 401/403/404/400 is a decision, not a hiccup — retrying it only doubles the
 * time the user stares at a spinner before seeing the same failure. Network
 * errors and 5xx are worth one more attempt.
 */
function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: retryQuery,
            // Returning to the tab re-ran every query on the page, blanking
            // screens that were already correct. The staleTime above still
            // refreshes anything genuinely old on the next navigation.
            refetchOnWindowFocus: false,
            // Keep showing the last good data while a refetch is in flight, so
            // moving between pages doesn't flash an empty screen each time.
            placeholderData: keepPreviousData,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
