'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Uploads a bill, invoice or statement through the ordinary document pipeline.
 *
 * Shared by Purchase, Sales and Banking so there is one upload path in the
 * product: OCR, extraction and the proposal all behave identically wherever
 * the file was dropped, and the entry still lands in Review for a person to
 * approve (Invariant 4) rather than posting straight to the ledger.
 */
export function DocumentUploadButton({
  label = 'Upload',
  hint,
  accept = '.pdf,.jpg,.jpeg,.png,.webp,.tiff,.heic,.csv,.xlsx,.xls,.docx,.txt',
  onUploaded,
  className,
}: {
  label?: string;
  hint?: string;
  accept?: string;
  onUploaded?: (message: string) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    const body = new FormData();
    body.append('file', file);

    setBusy(true);
    setError(null);
    try {
      await api.post('/documents/upload', body);
      // The badge and the Inbox both change as a result of this.
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
      onUploaded?.(`${file.name} uploaded — reading it now`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <label
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 rounded-sm border border-line-200 px-3 py-2 text-body text-ink-700 transition-colors hover:bg-honey-50',
          busy && 'cursor-wait opacity-60',
        )}
      >
        <Upload size={14} />
        {busy ? 'Uploading…' : label}
        <input
          type="file"
          accept={accept}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so picking the same file twice still fires a change.
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {hint ? <p className="mt-1 text-caption text-ink-400">{hint}</p> : null}
      {error ? <p className="mt-1 text-caption text-error-fg">{error}</p> : null}
    </div>
  );
}
