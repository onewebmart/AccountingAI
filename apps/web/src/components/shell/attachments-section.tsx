'use client';

import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

interface AttachmentRow {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

const size = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Files kept against a record: a delivery note, an agreement, a bank advice.
 * Kept, not read. Removing one hides it; the audit trail keeps the record.
 */
export function AttachmentsSection({
  entityType,
  entityId,
}: {
  entityType: 'SalesInvoice' | 'PurchaseBill' | 'Journal' | 'PartyPayment' | 'Customer' | 'Vendor';
  entityId: string;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = ['attachments', entityType, entityId];
  const { data, isError } = useQuery({ queryKey: key, queryFn: () => api.get<AttachmentRow[]>(`/attachments?entityType=${entityType}&entityId=${entityId}`) });

  const add = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('entityType', entityType);
      body.append('entityId', entityId);
      body.append('file', file);
      return api.post('/attachments', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const open = async (id: string) => {
    const { url } = await api.get<{ url: string }>(`/attachments/${id}/url`);
    window.open(url, '_blank', 'noopener');
  };
  const error = add.error ?? remove.error;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-caption font-semibold uppercase tracking-wide text-ink-500">Attachments</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline disabled:opacity-50"
          disabled={add.isPending}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={12} /> {add.isPending ? 'Attaching…' : 'Attach a file'}
        </button>
        <input
          ref={input}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) add.mutate(file);
          }}
        />
      </div>
      {isError && <p className="text-caption text-error-fg">Couldn&apos;t load the attachments.</p>}
      {(data ?? []).length === 0 ? (
        <p className="text-caption text-ink-400">None.</p>
      ) : (
        <ul className="space-y-1">
          {data!.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-caption">
              <button type="button" className="truncate text-left text-ink-700 hover:text-ink-900 hover:underline" onClick={() => void open(a.id)}>
                {a.fileName}
              </button>
              <span className="flex shrink-0 items-center gap-2 text-ink-400">
                {size(a.sizeBytes)}
                <button
                  type="button"
                  aria-label={`Remove ${a.fileName}`}
                  className="hover:text-error-fg"
                  disabled={remove.isPending}
                  onClick={() => window.confirm(`Remove ${a.fileName}? The audit trail keeps a record of it.`) && remove.mutate(a.id)}
                >
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-caption text-error-fg">{error instanceof ApiError && error.message ? error.message : "Couldn't change the attachments."}</p>}
    </div>
  );
}
