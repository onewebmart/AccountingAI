'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page/page-shell';
import { api, ApiError } from '@/lib/api';
import { ReportBuilder } from '@/components/reports/center/builder';
import type { CustomSpec } from '@/components/reports/center/types';

/** Change a custom report: only the person who made it can. */
export default function EditCustomReportPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['reports', 'custom', id], queryFn: () => api.get<CustomSpec>(`/reports/custom/${id}`) });
  if (q.isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Opening the report…</p>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <Link href="/reports?view=mine" className="inline-flex items-center gap-1 text-caption text-ink-500 hover:underline"><ChevronLeft size={13} /> My Reports</Link>
        <p className="text-body text-error-fg">{q.error instanceof ApiError ? q.error.message : 'Could not open this report.'}</p>
      </div>
    );
  }
  const spec = q.data;
  return (
    <div>
      <PageHeader title={`Edit ${spec.name}`} subtitle={spec.kind === 'derived' ? 'Made from an existing report.' : 'Made from a module.'} back={{ href: `/reports/view/${encodeURIComponent(spec.key!)}`, label: spec.name }} guide="reports" />
      {spec.mine === false ? <p className="text-body text-ink-600">Only the person who made this report can change it. Open it and choose Customize to make your own.</p> : <ReportBuilder mode={spec.kind} initial={spec} />}
    </div>
  );
}
