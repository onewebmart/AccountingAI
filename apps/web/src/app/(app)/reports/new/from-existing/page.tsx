'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page/page-shell';
import { ReportBuilder } from '@/components/reports/center/builder';

function FromExisting() {
  const params = useSearchParams();
  return (
    <div>
      <PageHeader title="Create from existing report" subtitle="Pick a report, then choose its columns, period, filters, grouping and sorting." back={{ href: '/reports/new', label: 'Create Custom Report' }} guide="reports" />
      <ReportBuilder mode="derived" baseKey={params.get('report')} />
    </div>
  );
}

export default function FromExistingPage() {
  return (
    <Suspense>
      <FromExisting />
    </Suspense>
  );
}
