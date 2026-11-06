'use client';

import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Loader2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ACCEPT, cx, fileSize, type UploadItem } from './library';

/** The big drop area: drag files on it, or choose them. */
export function DropArea({ onFiles, accept = ACCEPT, title = 'Drag & Drop Files Here', hint }: {
  onFiles: (files: File[]) => void;
  accept?: string;
  title?: string;
  hint?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => {
    if (list?.length) onFiles(Array.from(list));
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={cx(
        'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
        dragging ? 'border-marigold-400 bg-honey-100' : 'border-line-200 bg-surface-card',
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = ''; // so choosing the same file again still uploads it
        }}
      />
      <UploadCloud size={36} className={dragging ? 'text-marigold-400' : 'text-ink-300'} aria-hidden />
      <p className="mt-3 font-display text-h3 text-ink-900">{title}</p>
      <p className="mt-1 text-body text-ink-500">Upload your documents (images, PDF, Word or spreadsheets) here</p>
      <Button type="button" className="mt-5" onClick={() => input.current?.click()}>
        Choose files to upload
      </Button>
      <p className="mt-3 text-caption text-ink-400">{hint ?? 'Up to 20 MB each. Several at once is fine.'}</p>
    </div>
  );
}

/** One line per file being uploaded: its progress, then what happened. */
export function UploadList({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  if (!items.length) return null;
  const finished = items.some((it) => it.state !== 'queued' && it.state !== 'uploading');
  return (
    <section aria-label="Uploads" className="rounded-xl border border-line-200 bg-surface-card">
      <div className="flex items-center justify-between border-b border-line-100 px-4 py-2">
        <p className="text-caption font-medium text-ink-700">Uploads</p>
        {finished && (
          <button type="button" className="text-caption text-ink-500 hover:text-ink-900 hover:underline" onClick={onClear}>
            Clear finished
          </button>
        )}
      </div>
      <ul className="divide-y divide-line-100">
        {items.map((it) => (
          <li key={it.id} className="px-4 py-2.5">
            <div className="flex items-center gap-3">
              <StateIcon state={it.state} />
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-900" title={it.name}>{it.name}</span>
              <span className="font-mono text-caption tabular-nums text-ink-400">{fileSize(it.size)}</span>
              <span
                className={cx(
                  'w-40 shrink-0 text-right text-caption',
                  it.state === 'error' ? 'text-error-fg' : it.state === 'done' ? 'text-success-fg' : it.state === 'duplicate' ? 'text-error-fg' : 'text-pending-fg',
                )}
              >
                {it.state === 'queued' ? 'Waiting…' : it.state === 'uploading' ? `Uploading ${Math.round(it.progress * 100)}%` : it.state === 'done' ? 'Sent for reading' : it.state === 'duplicate' ? 'Duplicate?' : 'Not uploaded'}
              </span>
            </div>
            {(it.state === 'uploading' || it.state === 'queued') && (
              <div className="ml-7 mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sink" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(it.progress * 100)} aria-label={`Uploading ${it.name}`}>
                <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.max(it.progress * 100, it.state === 'uploading' ? 3 : 0)}%` }} />
              </div>
            )}
            {(it.state === 'error' || it.state === 'duplicate') && it.message && <p className="ml-7 mt-1 text-caption text-error-fg">{it.message}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StateIcon({ state }: { state: UploadItem['state'] }) {
  if (state === 'done') return <CheckCircle2 size={16} className="shrink-0 text-success-fg" aria-hidden />;
  if (state === 'duplicate') return <Copy size={16} className="shrink-0 text-error-fg" aria-hidden />;
  if (state === 'error') return <AlertCircle size={16} className="shrink-0 text-error-fg" aria-hidden />;
  return <Loader2 size={16} className={cx('shrink-0 text-pending-fg', state === 'uploading' && 'animate-spin')} aria-hidden />;
}
