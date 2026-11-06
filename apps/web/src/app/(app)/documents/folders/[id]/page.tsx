'use client';

import Link from 'next/link';
import { Folder as FolderIcon } from 'lucide-react';
import { AllDocuments } from '@/components/documents/all-documents';
import { useFolders } from '@/components/documents/library';
import { EmptyState, PageHeader } from '@/components/page/page-shell';
import { Button } from '@/components/ui/button';

/** One folder's files. Rename or delete it in the panel. */
export default function FolderPage({ params }: { params: { id: string } }) {
  const folders = useFolders();
  const folder = folders.data?.find((f) => f.id === params.id);

  if (folders.isSuccess && !folder) {
    return (
      <div>
        <PageHeader title="Folder" />
        <EmptyState
          title="This folder is gone"
          body="It may have been deleted; its files are in no folder now, and still in All Documents."
          action={<Button variant="secondary" asChild><Link href="/documents">Open All Documents</Link></Button>}
        />
      </div>
    );
  }

  return (
    <AllDocuments
      folderId={params.id}
      title={folder?.name ?? 'Folder'}
      meta={<FolderIcon size={18} className="text-ink-400" aria-hidden />}
      subtitle="Files filed in this folder. Rename or delete it under Folders; deleting moves its files to no folder."
    />
  );
}
