'use client';

import { PageHeader } from '@/components/page/page-shell';
import { ReportBuilder } from '@/components/reports/center/builder';

export default function NewModuleReportPage() {
  return (
    <div>
      <PageHeader title="Create an entirely new report" subtitle="Pick a module, its fields and conditions, group with sums, and sort." back={{ href: '/reports/new', label: 'Create Custom Report' }} guide="reports" />
      <ReportBuilder mode="module" />
    </div>
  );
}
