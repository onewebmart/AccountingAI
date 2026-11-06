'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Blocks, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page/page-shell';

const CHOICES = [
  {
    id: 'existing',
    href: '/reports/new/from-existing',
    icon: FileSpreadsheet,
    title: 'Create from existing report',
    body: 'Pick a report, then make it yours: choose and order its columns, filter its rows, group them with subtotals and sort them.',
  },
  {
    id: 'module',
    href: '/reports/new/module',
    icon: Blocks,
    title: 'Create an entirely new report',
    body: 'Build one from a module: invoices, bills, expenses, payments, journal lines, items, customers, vendors or time. Pick its fields, conditions, grouping and sort.',
  },
] as const;

/** Create New Report: start from an existing report, or from a module. */
export default function NewReportPage() {
  const router = useRouter();
  const [pick, setPick] = useState<(typeof CHOICES)[number]['id']>('existing');
  const chosen = CHOICES.find((c) => c.id === pick)!;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create Custom Report" subtitle="A custom report keeps only its design; every time it runs it reads the books afresh." back={{ href: '/reports', label: 'Reports Center' }} guide="reports" />
      <div role="radiogroup" aria-label="How to start" className="grid gap-3 md:grid-cols-2">
        {CHOICES.map((c) => {
          const Icon = c.icon;
          const on = pick === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPick(c.id)}
              onDoubleClick={() => router.push(c.href)}
              className={`flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${on ? 'border-saffron-600 bg-honey-50 ring-2 ring-saffron-600/20' : 'border-line-200 bg-surface-card hover:border-saffron-600/60'}`}
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${on ? 'bg-saffron-600 text-white' : 'bg-surface-sink text-ink-600'}`}><Icon size={20} /></span>
              <span className="text-h3 font-display text-ink-900">{c.title}</span>
              <span className="text-body text-ink-600">{c.body}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button asChild>
          <Link href={chosen.href}>Proceed <ArrowRight size={15} /></Link>
        </Button>
        <Button variant="ghost" asChild><Link href="/reports">Cancel</Link></Button>
      </div>
    </div>
  );
}
