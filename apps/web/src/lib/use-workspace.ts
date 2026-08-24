'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Workspace {
  user: { id: string; name: string; email: string; initials: string; role: string };
  org: { id: string; name: string; gstin?: string };
  /** Present only when this org belongs to a CA firm. */
  firm?: { id: string; name: string };
  counts: { inbox: number; review: number };
  aiUsage: { spentPaise: number; period: string };
}

/**
 * Backs the app shell — org identity, badge counts and the AI meter.
 *
 * Refetched on window focus so the badges match the page beside them. A sidebar
 * claiming seven items to review next to a screen saying "nothing to review" is
 * worse than no badge at all: it teaches people not to trust the number.
 */
export function useWorkspace() {
  return useQuery<Workspace>({
    queryKey: ['workspace'],
    queryFn: () => api.get<Workspace>('/workspace'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
