'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ProjectForm } from '@/components/time/project-form';
import { useProjectList } from '@/components/time/types';

export default function EditProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const list = useProjectList();
  const project = (list.data ?? []).find((p) => p.id === id);

  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isLoading) return <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>;
  if (!project) return <EmptyState title="No such project" action={<Button asChild><Link href="/time/projects">Projects</Link></Button>} />;

  return (
    <div>
      <PageHeader title={`Edit ${project.name}`} back={{ href: `/time/projects/${id}`, label: project.name }} />
      <ProjectForm
        key={project.id}
        project={project}
        cancelHref={`/time/projects/${id}`}
        onSaved={() => {
          notify('Project saved');
          router.push(`/time/projects/${id}`);
        }}
      />
    </div>
  );
}
