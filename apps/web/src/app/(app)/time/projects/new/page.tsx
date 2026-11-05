'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ProjectForm } from '@/components/time/project-form';

export default function NewProjectPage() {
  const router = useRouter();
  return (
    <div>
      <PageHeader title="New project" back={{ href: '/time/projects', label: 'Projects' }} />
      <ProjectForm
        project={null}
        cancelHref="/time/projects"
        onSaved={(id) => {
          notify('Project saved');
          router.push(`/time/projects/${id}`);
        }}
      />
    </div>
  );
}
