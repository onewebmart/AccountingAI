'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ChevronDown, ExternalLink, File as FileIcon, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, TableCard, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { AddToMenu } from './add-to-menu';
import { canAddTo } from './document-entry';
import { ACCEPT, FILE_KINDS, STAGE, associatedHref, cx, uploaderText, useFolders, useLibrary, useUploads, type FileKind, type Folder, type LibraryRow, type Stage } from './library';
import { UploadList } from './upload-parts';

const STATUS_FILTERS: Array<[string, string]> = [
  ['all', 'All statuses'],
  ['to-enter', 'Not entered yet'],
  ['ready', 'Ready to review'],
  ['reading', 'Reading…'],
  ['failed', "Couldn't read"],
  ['duplicate', 'Duplicate?'],
  ['posted', 'Posted'],
  ['entered', 'Entered'],
  ['imported', 'Imported statements'],
  ['attached', 'Attached to a record'],
  ['rejected', 'Rejected'],
];
const select = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';
const menuItem =
  'flex cursor-pointer select-none items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-body text-ink-900 outline-none data-[highlighted]:bg-honey-50';

/** A read upload not yet entered, and not a statement whose lines went to Banking: "Add to" can open a form filled from it. */
const addable = (r: LibraryRow) => r.kind === 'upload' && r.stage !== 'imported' && r.stage !== 'reconciled' && canAddTo(r.status, r.enteredAs);

function KindIcon({ row }: { row: LibraryRow }) {
  const cls = 'mt-0.5 shrink-0 text-ink-400';
  if (row.kind === 'attachment') return <Paperclip size={15} className={cls} aria-hidden />;
  if (row.fileKind === 'image') return <FileImage size={15} className={cls} aria-hidden />;
  if (row.fileKind === 'spreadsheet') return <FileSpreadsheet size={15} className={cls} aria-hidden />;
  if (row.fileKind === 'pdf' || row.fileKind === 'document') return <FileText size={15} className={cls} aria-hidden />;
  return <FileIcon size={15} className={cls} aria-hidden />;
}

const TONE = {
  pending: 'border-pending-fg/30 bg-pending-bg text-pending-fg',
  success: 'border-success-fg/30 bg-success-bg text-success-fg',
  neutral: 'border-line-200 bg-surface-sink text-ink-600',
  error: 'border-error-fg/30 bg-error-bg text-error-fg',
};
/** Amber waits or is AI's, green is done, grey is neither, cool red is a problem. */
export function Chip({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-caption font-medium', TONE[tone])}>{children}</span>;
}

export function StageChip({ stage }: { stage: Stage }) {
  const s = STAGE[stage];
  return (
    <Chip tone={s.tone}>
      {stage === 'reading' && <Loader2 size={11} className="animate-spin" aria-hidden />}
      {s.label}
    </Chip>
  );
}
const cell = 'px-3 py-2.5';

/** "Associated to": a link to the record, the statement's reconciliation, or Review. */
export function AssociatedLink({ row }: { row: LibraryRow }) {
  const a = row.associatedTo;
  if (!a) return <span className="text-caption text-ink-300">—</span>;
  const href = associatedHref(a);
  const tone = a.kind === 'review' ? 'text-pending-fg' : a.kind === 'duplicate' || a.kind === 'rejected' ? 'text-ink-500' : 'text-ink-900';
  if (!href) return <span className={cx('block break-words text-caption leading-snug', tone)}>{a.label}</span>;
  return (
    <Link href={href} className={cx('block break-words text-caption font-medium leading-snug hover:underline', tone)}>
      {a.label}
    </Link>
  );
}

function FolderMenu({ row, folders, onMove, disabled }: { row: LibraryRow; folders: Folder[]; onMove: (folderId: string | null) => void; disabled: boolean }) {
  const current = row.folder?.id ?? null;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        disabled={disabled}
        className="inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-caption text-ink-600 hover:bg-honey-50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 data-[state=open]:bg-honey-50"
        aria-label={`Folder for ${row.fileName}: ${row.folder?.name ?? 'none'}. Move it`}
      >
        <span className="truncate">{row.folder?.name ?? <span className="text-ink-300">No folder</span>}</span>
        <ChevronDown size={12} className="shrink-0" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={4} collisionPadding={8} className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[12rem] overflow-y-auto rounded-lg border border-line-200 bg-surface-card p-1 shadow-lg">
          <Menu.Label className="px-2.5 pb-0.5 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">Move to</Menu.Label>
          <Menu.Item className={menuItem} onSelect={() => current !== null && onMove(null)}>
            No folder {current === null && <Check size={13} className="text-success-fg" aria-hidden />}
          </Menu.Item>
          {folders.map((f) => (
            <Menu.Item key={f.id} className={menuItem} onSelect={() => current !== f.id && onMove(f.id)}>
              <span className="truncate">{f.name}</span>
              {current === f.id && <Check size={13} className="text-success-fg" aria-hidden />}
            </Menu.Item>
          ))}
          {folders.length === 0 && <p className="px-2.5 py-1.5 text-caption text-ink-500">No folders yet. Create one with + under Folders.</p>}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  };
};

/**
 * Every file in the books, or one folder's: uploads read by the inbox and
 * files kept against records, each with what it became. Select several to
 * file them in a folder together.
 */
export function AllDocuments({ folderId, title, subtitle, meta }: { folderId?: string; title: string; subtitle?: string; meta?: React.ReactNode }) {
  const qc = useQueryClient();
  const library = useLibrary(folderId);
  const folders = useFolders();
  const uploads = useUploads(folderId ?? null);
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [status, setStatus] = useState('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // A link may name the status to show: /documents?status=to-enter.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('status');
    if (wanted && STATUS_FILTERS.some(([v]) => v === wanted)) setStatus(wanted);
  }, []);
  useEffect(() => setSelected(new Set()), [folderId]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['documents'] });
  const move = useMutation({
    mutationFn: (v: { rows: LibraryRow[]; folderId: string | null }) =>
      api.post<{ moved: number; folder: { name: string } | null }>('/documents/move', {
        folderId: v.folderId,
        items: v.rows.map((r) => ({ kind: r.kind === 'upload' ? 'document' : 'attachment', id: r.id })),
      }),
    onSuccess: (res) => {
      notify(res.moved === 0 ? 'Already there' : `Moved ${res.moved} ${res.moved === 1 ? 'file' : 'files'} to ${res.folder ? res.folder.name : 'no folder'}`);
      setSelected(new Set());
      setTarget('');
      refresh();
    },
    onError: (e) => notify(errorText(e, "Couldn't move those files."), 'error'),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/retry`),
    onSuccess: () => notify('Sent for reading again'),
    onError: (e) => notify(errorText(e, "Couldn't read it again."), 'error'),
    onSettled: refresh,
  });

  const rows = library.data?.data ?? [];
  const needle = search.trim().toLowerCase();
  const shown = rows
    .filter(
      (r) =>
        (kind === 'all' || r.fileKind === kind) &&
        (status === 'all' || (status === 'to-enter' ? addable(r) : r.stage === status)) &&
        (!needle ||
          [r.fileName, r.vendor, r.invoiceNumber, r.associatedTo?.label, uploaderText(r.uploadedBy), r.folder?.name].some((s) => s?.toLowerCase().includes(needle))),
    )
    .sort((a, b) => (newestFirst ? b.uploadedAt.localeCompare(a.uploadedAt) : a.uploadedAt.localeCompare(b.uploadedAt)));
  const picked = shown.filter((r) => selected.has(r.key));
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const folderList = folders.data ?? [];

  const openFile = async (r: LibraryRow) => {
    setBusy(r.key);
    try {
      const { url } = await api.get<{ url: string }>(r.kind === 'upload' ? `/documents/${r.id}/url` : `/attachments/${r.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      notify(errorText(err, "Couldn't open the file."), 'error');
    } finally {
      setBusy(null);
    }
  };
  const toggle = (key: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <PageHeader
        guide="documents"
        title={title}
        meta={meta}
        subtitle={subtitle}
        actions={
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) uploads.add(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            <Button onClick={() => input.current?.click()}>
              <Upload size={16} /> Upload file
            </Button>
          </>
        }
      />

      {uploads.items.length > 0 && (
        <div className="mb-4">
          <UploadList items={uploads.items} onClear={uploads.clearFinished} />
        </div>
      )}

      <ListToolbar search={search} onSearch={setSearch} placeholder="Search files, parties, records">
        <select className={select} value={kind} onChange={(e) => setKind(e.target.value as FileKind | 'all')} aria-label="Filter by file type">
          {FILE_KINDS.map(([v, l]) => (
            <option key={v} value={v}>{v === 'all' ? 'Filter by file type: all' : l}</option>
          ))}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          {STATUS_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </ListToolbar>

      {picked.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-marigold-400/60 bg-honey-50 px-3 py-2">
          <span className="text-body font-medium text-ink-900">
            <span className="font-mono tabular-nums">{picked.length}</span> selected
          </span>
          <label className="flex items-center gap-2 text-caption text-ink-600">
            Move to
            <select className="h-9 rounded-md border border-line-200 bg-white px-2 text-body text-ink-900" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Folder to move the selected files to">
              <option value="">Choose a folder</option>
              <option value="none">No folder</option>
              {folderList.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={!target || move.isPending} onClick={() => move.mutate({ rows: picked, folderId: target === 'none' ? null : target })}>
            {move.isPending ? 'Moving…' : 'Move'}
          </Button>
          <button type="button" className="text-caption text-ink-500 hover:text-ink-900 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {library.isError ? (
        <QueryError error={library.error} onRetry={() => void library.refetch()} />
      ) : library.isLoading ? (
        <p className="flex items-center gap-2 py-10 text-caption text-ink-400">
          <Loader2 size={14} className="animate-spin" /> Loading documents…
        </p>
      ) : shown.length === 0 ? (
        <EmptyState
          guide={rows.length || folderId ? undefined : 'documents'}
          title={rows.length ? 'No document matches' : folderId ? 'This folder is empty' : 'No documents yet'}
          body={
            rows.length
              ? 'Change the search, the file type or the status.'
              : folderId
                ? 'Upload a file here, or pick files in All Documents and move them into this folder.'
                : 'Upload bills, invoices, receipts and statements, or attach files to a record.'
          }
          action={rows.length ? undefined : <Button variant="secondary" onClick={() => input.current?.click()}><Upload size={16} /> Upload file</Button>}
        />
      ) : (
        <TableCard>
          {/* Fixed widths, the file name taking the rest: beside the Documents panel there is no room to spare. */}
          <table className="w-full min-w-[820px] table-fixed">
            <colgroup>
              <col className="w-9" />
              <col />
              <col className="w-[128px]" />
              <col className="w-[104px]" />
              <col className="w-[160px]" />
              <col className="w-[120px]" />
              <col className="w-[112px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={cx(th, 'pr-0')}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={allPicked}
                    onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((r) => r.key)))}
                    aria-label={allPicked ? 'Clear the selection' : 'Select every file shown'}
                  />
                </th>
                <th className={th}>File name</th>
                <th className={th}>Uploaded by</th>
                <th className={th} aria-sort={newestFirst ? 'descending' : 'ascending'}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-ink-900" onClick={() => setNewestFirst((v) => !v)}>
                    Uploaded on {newestFirst ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />}
                  </button>
                </th>
                <th className={th}>Associated to</th>
                <th className={th}>Folder</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const at = when(r.uploadedAt);
                const detail = [r.vendor, r.invoiceNumber].filter(Boolean).join(' · ');
                return (
                  <tr key={r.key} className={cx('border-b border-line-100 align-top last:border-0 hover:bg-surface-sink', selected.has(r.key) && 'bg-honey-50')}>
                    <td className={cx(cell, 'pr-0')}>
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={selected.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.fileName}`} />
                    </td>
                    <td className={cell}>
                      <div className="flex items-start gap-2">
                        <KindIcon row={r} />
                        <div className="min-w-0">
                          <button type="button" className="flex max-w-full items-center gap-1 text-left font-mono text-caption text-ink-900 hover:underline disabled:opacity-60" disabled={busy === r.key} onClick={() => void openFile(r)} title={`Open ${r.fileName}`}>
                            <span className="truncate">{r.fileName}</span>
                            {busy === r.key ? <Loader2 size={11} className="shrink-0 animate-spin text-ink-400" /> : <ExternalLink size={11} className="shrink-0 text-ink-400" aria-hidden />}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <StageChip stage={r.stage} />
                            {/* An empty read reads ₹0: nothing was read, so nothing is shown. */}
                            {!!r.totalAmountPaise && <span className="font-mono text-caption tabular-nums text-ink-700">{formatPaise(r.totalAmountPaise)}</span>}
                          </div>
                          {detail && <p className="mt-0.5 truncate text-caption text-ink-500" title={detail}>{detail}</p>}
                          {r.failureReason && <p className="mt-1 text-caption leading-snug text-error-fg">{r.failureReason}</p>}
                          {r.stage === 'failed' && r.kind === 'upload' && (
                            <button type="button" className="mt-1 inline-flex items-center gap-1 text-caption font-medium text-brand-800 hover:underline disabled:opacity-50" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>
                              <RefreshCw size={12} /> Try again
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={cell}>
                      <p className="truncate text-caption text-ink-600" title={uploaderText(r.uploadedBy)}>{uploaderText(r.uploadedBy)}</p>
                    </td>
                    <td className={cx(cell, 'whitespace-nowrap text-caption text-ink-600')}>
                      {at.date}
                      <span className="block font-mono text-[0.7rem] tabular-nums text-ink-400">{at.time}</span>
                    </td>
                    <td className={cell}><AssociatedLink row={r} /></td>
                    <td className={cell}>
                      <FolderMenu row={r} folders={folderList} disabled={move.isPending} onMove={(f) => move.mutate({ rows: [r], folderId: f })} />
                    </td>
                    <td className={cx(cell, 'whitespace-nowrap text-right')}>
                      {addable(r) && <AddToMenu documentId={r.id} fileName={r.fileName} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            <span className="font-mono tabular-nums">{shown.length}</span> {shown.length === 1 ? 'file' : 'files'}
            {library.data?.truncated ? '. The latest 200 files are listed.' : '.'}
          </div>
        </TableCard>
      )}
    </div>
  );
}
