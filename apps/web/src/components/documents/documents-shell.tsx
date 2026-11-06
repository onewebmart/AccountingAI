'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileStack, Folder as FolderIcon, Inbox, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { cx, usePipeline, useFolders, type Folder } from './library';

/**
 * The Documents area: a panel of its own on the left (All Documents, the
 * Files and Bank Statements inboxes, and folders) beside the page. Folders
 * are made, renamed and deleted right in the panel, never in a pop-up.
 */
export function DocumentsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <DocumentsPanel />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const itemClass = (active: boolean) =>
  cx(
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
    active ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-surface-sink hover:text-ink-900',
  );
const groupLabel = 'px-3 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-ink-400';
const smallInput = 'h-8 w-full rounded-md border border-line-200 bg-white px-2 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';

function Count({ n, tone }: { n: number; tone?: 'pending' | 'error' }) {
  if (!n) return null;
  return (
    <span
      className={cx(
        'ml-auto rounded-full px-1.5 py-px font-mono text-[0.7rem] tabular-nums',
        tone === 'error' ? 'bg-error-bg text-error-fg' : tone === 'pending' ? 'bg-pending-bg text-pending-fg' : 'text-ink-400',
      )}
    >
      {n}
    </span>
  );
}

function DocumentsPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const folders = useFolders();
  const pipeline = usePipeline();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['documents', 'folders'] });
    void qc.invalidateQueries({ queryKey: ['documents', 'library'] });
  };
  const create = useMutation({
    mutationFn: (n: string) => api.post<Folder>('/documents/folders', { name: n }),
    onSuccess: (f) => {
      notify('Folder created');
      setCreating(false);
      setName('');
      setProblem(null);
      refresh();
      router.push(`/documents/folders/${f.id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't create the folder.")),
  });
  const rename = useMutation({
    mutationFn: ({ id, n }: { id: string; n: string }) => api.patch<Folder>(`/documents/folders/${id}`, { name: n }),
    onSuccess: () => {
      notify('Folder renamed');
      setEditing(null);
      setProblem(null);
      refresh();
    },
    onError: (e) => setProblem(errorText(e, "Couldn't rename the folder.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ filesMoved: number }>(`/documents/folders/${id}`),
    onSuccess: (res, id) => {
      notify(res.filesMoved ? `Folder deleted. ${res.filesMoved} ${res.filesMoved === 1 ? 'file is' : 'files are'} now in no folder.` : 'Folder deleted');
      setDeleting(null);
      refresh();
      if (pathname === `/documents/folders/${id}`) router.push('/documents');
    },
    onError: (e) => setProblem(errorText(e, "Couldn't delete the folder.")),
  });

  const list = folders.data ?? [];
  const p = pipeline.data;
  const filesWaiting = p ? p.reading + p.couldNotRead.count + p.duplicates : 0;

  return (
    <nav aria-label="Documents" className="w-full shrink-0 rounded-xl border border-line-200 bg-surface-card p-2 shadow-e1 lg:sticky lg:top-24 lg:w-52 lg:self-start">
      <p className="px-3 pb-2 pt-2 font-display text-h3 text-ink-900">Documents</p>

      <Link href="/documents" className={itemClass(pathname === '/documents')}>
        <FileStack size={16} className="shrink-0 text-ink-400" /> All Documents
      </Link>

      <p className={groupLabel}>Inboxes</p>
      <Link href="/inbox" className={itemClass(pathname === '/inbox')}>
        <Inbox size={16} className="shrink-0 text-ink-400" /> Files
        <Count n={filesWaiting} tone={p && p.couldNotRead.count > 0 ? 'error' : 'pending'} />
      </Link>
      <Link href="/documents/statements" className={itemClass(pathname === '/documents/statements')}>
        <Landmark size={16} className="shrink-0 text-ink-400" /> Bank Statements
      </Link>

      <div className="flex items-center justify-between pr-1">
        <p className={groupLabel}>Folders</p>
        <button
          type="button"
          aria-label="Create a folder"
          title="Create a folder"
          className="mt-3 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-500 hover:bg-honey-50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          onClick={() => {
            setCreating((v) => !v);
            setProblem(null);
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {creating && (
        <form
          className="space-y-1.5 px-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <input autoFocus className={smallInput} placeholder="Folder name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Folder name" />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" className="h-8 min-h-0 px-2.5" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Creating…' : 'Create folder'}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 min-h-0 px-2.5" onClick={() => { setCreating(false); setName(''); setProblem(null); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {folders.isError ? (
        <p className="px-3 py-1 text-caption text-error-fg">{errorText(folders.error, "Couldn't load the folders.")}</p>
      ) : folders.isLoading ? (
        <p className="px-3 py-1 text-caption text-ink-400">Loading…</p>
      ) : list.length === 0 && !creating ? (
        <div className="px-3 pb-2 text-caption text-ink-500">
          There are no folders.{' '}
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setCreating(true)}>
            Create new folder
          </button>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {list.map((f) => {
            const href = `/documents/folders/${f.id}`;
            if (editing === f.id) {
              return (
                <li key={f.id}>
                  <form
                    className="space-y-1.5 px-2 py-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editName.trim()) rename.mutate({ id: f.id, n: editName.trim() });
                    }}
                  >
                    <input autoFocus className={smallInput} maxLength={60} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={`New name for ${f.name}`} />
                    <div className="flex gap-1.5">
                      <Button type="submit" size="sm" className="h-8 min-h-0 px-2.5" disabled={rename.isPending || !editName.trim()}>
                        {rename.isPending ? 'Saving…' : 'Rename'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 min-h-0 px-2.5" onClick={() => { setEditing(null); setProblem(null); }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </li>
              );
            }
            return (
              <li key={f.id}>
                <div className="group relative">
                  <Link href={href} className={itemClass(pathname === href)}>
                    <FolderIcon size={16} className="shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                    <span className="font-mono text-[0.7rem] tabular-nums text-ink-400 group-hover:invisible group-focus-within:invisible">{f.count}</span>
                  </Link>
                  {/* Over the count while the row is pointed at or focused, so names keep the width the rest of the time. */}
                  <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface-card pl-1 shadow-[-8px_0_8px_-4px_rgba(255,255,255,1)] group-hover:flex group-focus-within:flex">
                    <button
                      type="button"
                      aria-label={`Rename ${f.name}`}
                      title="Rename"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:bg-honey-50 hover:text-ink-900"
                      onClick={() => { setEditing(f.id); setEditName(f.name); setDeleting(null); setProblem(null); }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${f.name}`}
                      title="Delete"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:bg-error-bg hover:text-error-fg"
                      onClick={() => { setDeleting(f.id); setEditing(null); setProblem(null); }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {deleting === f.id && (
                  <div className="mx-2 mb-1 mt-1 rounded-md border border-line-200 bg-surface-sink p-2 text-caption text-ink-700">
                    <p>
                      Delete <span className="font-medium">{f.name}</span>?{' '}
                      {f.count ? `Its ${f.count} ${f.count === 1 ? 'file moves' : 'files move'} to no folder; nothing is deleted.` : 'It is empty.'}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Button type="button" variant="destructive" size="sm" className="h-8 min-h-0 px-2.5" disabled={remove.isPending} onClick={() => remove.mutate(f.id)}>
                        {remove.isPending ? 'Deleting…' : 'Delete folder'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 min-h-0 px-2.5" onClick={() => setDeleting(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="px-3 pb-2 pt-1 text-caption text-error-fg">{problem}</p>}
    </nav>
  );
}
