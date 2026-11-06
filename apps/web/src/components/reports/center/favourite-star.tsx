'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import type { CenterData, Definition } from './types';

/** The star beside a report's name: this person's favourite, kept on the server per organisation. */
export function FavouriteStar({ report, size = 15 }: { report: { key: string; title: string; favourite: boolean }; size?: number }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (favourite: boolean) => api.put(`/reports/favourites/${encodeURIComponent(report.key)}`, { favourite }),
    onMutate: (favourite) => {
      qc.setQueryData<CenterData>(['reports', 'center'], (d) =>
        d && { ...d, reports: d.reports.map((r) => (r.key === report.key ? { ...r, favourite } : r)), counts: { ...d.counts, favourites: d.counts.favourites + (favourite ? 1 : -1) } },
      );
      qc.setQueryData<Definition>(['reports', 'definition', report.key], (d) => d && { ...d, favourite });
    },
    onSuccess: (_r, favourite) => notify(favourite ? 'Added to favorites' : 'Removed from favorites'),
    onError: (e) => notify(e instanceof ApiError ? e.message : "Couldn't save the favorite. Try again.", 'error'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'center'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'definition', report.key] });
    },
  });
  return (
    <button
      type="button"
      aria-label={report.favourite ? `Remove ${report.title} from favorites` : `Add ${report.title} to favorites`}
      aria-pressed={report.favourite}
      title={report.favourite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => { e.preventDefault(); toggle.mutate(!report.favourite); }}
      className={`rounded p-0.5 transition-colors ${report.favourite ? 'text-brand-700' : 'text-ink-300 hover:text-brand-700'}`}
    >
      <Star size={size} fill={report.favourite ? 'currentColor' : 'none'} />
    </button>
  );
}
