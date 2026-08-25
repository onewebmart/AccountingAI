'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChecklistItemStatus,
  DocumentRequestStatus,
  FirmService,
} from '@ai-accounting/shared';
import { CheckCircle2, Clock, FileText, Plus, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Client, SERVICE_LABELS } from '@/lib/crm-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/motion/primitives';
import { EmptyState } from '@/components/crm/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ChecklistItem {
  key: string;
  label: string;
  status: ChecklistItemStatus;
  documentName?: string;
  autoMatched: boolean;
}

interface DocRequest {
  _id: string;
  clientName: string;
  clientOrgId: string;
  purpose: string;
  dueDate: string;
  status: DocumentRequestStatus;
  items: ChecklistItem[];
  progress: { total: number; received: number; verified: number; percent: number; missingLabels: string[] };
}

type Filter = 'ALL' | 'MISSING' | 'PENDING_VERIFY' | 'COMPLETE';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All clients' },
  { key: 'MISSING', label: 'Missing docs' },
  { key: 'PENDING_VERIFY', label: 'Pending verify' },
  { key: 'COMPLETE', label: 'Complete' },
];

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Amber = received but unconfirmed (incl. AI-matched). Green = verified. */
function ItemPill({
  item,
  onVerify,
  verifying,
}: {
  item: ChecklistItem;
  onVerify: (key: string) => void;
  verifying: boolean;
}) {
  const received = item.status === ChecklistItemStatus.RECEIVED;
  const verified = item.status === ChecklistItemStatus.VERIFIED;

  return (
    <span
      title={item.documentName ?? undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs',
        verified && 'border-[#1E7B34]/20 bg-[#E6F4EA] text-[#1E7B34]',
        received && 'border-pending-fg/20 bg-pending-bg text-pending-fg',
        !received && !verified && 'border-line-200 bg-surface-card text-ink-500',
      )}
    >
      {verified ? <CheckCircle2 size={12} /> : received ? <Clock size={12} /> : null}
      {item.label}
      {item.autoMatched && received ? <Sparkles size={11} aria-label="Matched automatically" /> : null}
      {received ? (
        <button
          type="button"
          onClick={() => onVerify(item.key)}
          disabled={verifying}
          className="ml-1 rounded px-1 text-[11px] font-semibold text-saffron-700 hover:underline disabled:opacity-50"
        >
          {verifying ? '…' : 'Verify'}
        </button>
      ) : null}
    </span>
  );
}

function RequestCard({
  request,
  onVerify,
  verifyingKey,
  onRemind,
  reminding,
}: {
  request: DocRequest;
  onVerify: (requestId: string, key: string) => void;
  verifyingKey: string | null;
  onRemind: (requestId: string) => void;
  reminding: boolean;
}) {
  const complete = request.progress.missingLabels.length === 0;

  return (
    <li className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading font-semibold text-ink-900">{request.clientName}</p>
          <p className="mt-0.5 text-sm text-ink-500">
            {request.purpose} · due {formatDate(request.dueDate)}
            {!complete ? ` · ${request.progress.missingLabels.length} missing` : ''}
          </p>
        </div>
        {complete ? (
          <span className="rounded-full bg-[#E6F4EA] px-2.5 py-1 text-[11px] font-semibold text-[#1E7B34]">
            All documents received
          </span>
        ) : (
          <Button
            variant="secondary"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => onRemind(request._id)}
            disabled={reminding}
          >
            <Send size={13} />
            {reminding ? 'Queueing…' : 'Remind'}
          </Button>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {request.items.map((item) => (
          <li key={item.key}>
            <ItemPill
              item={item}
              onVerify={(key) => onVerify(request._id, key)}
              verifying={verifyingKey === `${request._id}:${item.key}`}
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-3">
        <Progress value={request.progress.percent} className="h-2 flex-1" />
        <span className="font-mono text-[11px] text-ink-500">
          {request.progress.received}/{request.progress.total} received
          {request.progress.verified > 0 ? ` · ${request.progress.verified} verified` : ''}
        </span>
      </div>
    </li>
  );
}

function NewRequestDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: { clientOrgId: string; service: FirmService; dueDate: string }) => void;
  submitting: boolean;
  error: Error | null;
}) {
  const [clientOrgId, setClientOrgId] = useState('');
  const [service, setService] = useState<FirmService | ''>('');
  const [dueDate, setDueDate] = useState('');

  const { data: clients } = useQuery<Client[]>({
    queryKey: ['firm', 'clients'],
    queryFn: () => api.get<Client[]>('/firm/clients'),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Request documents</DialogTitle>
          <DialogDescription>
            The checklist is built from the service you pick. Uploads are matched to it
            automatically, and you confirm each one.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!clientOrgId || !service || !dueDate) return;
            onSubmit({ clientOrgId, service, dueDate });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <Select value={clientOrgId || undefined} onValueChange={setClientOrgId}>
              <SelectTrigger id="client">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service">Service</Label>
            <Select value={service || undefined} onValueChange={(v) => setService(v as FirmService)}>
              <SelectTrigger id="service">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(FirmService).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SERVICE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">Needed by</Label>
            <Input
              id="dueDate"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !clientOrgId || !service || !dueDate}>
              {submitting ? 'Creating…' : 'Request documents'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const { data: requests, isLoading } = useQuery<DocRequest[]>({
    queryKey: ['crm', 'document-requests'],
    queryFn: () => api.get<DocRequest[]>('/crm/document-requests'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'document-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] });
  };

  const createRequest = useMutation({
    mutationFn: (payload: { clientOrgId: string; service: FirmService; dueDate: string }) =>
      api.post('/crm/document-requests', payload),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
    },
  });

  const verify = useMutation({
    mutationFn: ({ requestId, key }: { requestId: string; key: string }) =>
      api.post(`/crm/document-requests/${requestId}/items/${key}/verify`),
    onSettled: () => {
      setVerifyingKey(null);
      invalidate();
    },
  });

  const remind = useMutation({
    mutationFn: (requestIds?: string[]) =>
      api.post<{ remindersQueued: number; skippedComplete: number; skippedNoContact: number }>(
        '/crm/document-requests/remind',
        requestIds ? { requestIds } : {},
      ),
    onSettled: () => {
      setRemindingId(null);
      invalidate();
    },
  });

  const filtered = useMemo(() => {
    const all = requests ?? [];
    switch (filter) {
      case 'MISSING':
        return all.filter((r) => r.progress.missingLabels.length > 0);
      case 'PENDING_VERIFY':
        return all.filter((r) =>
          r.items.some((i) => i.status === ChecklistItemStatus.RECEIVED),
        );
      case 'COMPLETE':
        return all.filter((r) => r.progress.missingLabels.length === 0);
      default:
        return all;
    }
  }, [requests, filter]);

  return (
    <div>
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-900">Document hub</h1>
            <p className="mt-1 text-sm text-ink-500">
              Track what each client still owes you. Uploads are matched to the checklist
              automatically — you confirm each one before it counts as verified.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => {
                setRemindingId('ALL');
                remind.mutate(undefined);
              }}
              disabled={remind.isPending}
            >
              <Send size={16} />
              {remindingId === 'ALL' && remind.isPending ? 'Queueing…' : 'Remind everyone'}
            </Button>
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus size={16} />
              Request documents
            </Button>
          </div>
        </div>
      </FadeIn>

      {remind.isSuccess ? (
        <p className="mb-4 rounded-lg bg-[#E6F4EA] px-3 py-2 text-sm text-[#1E7B34]">
          Queued {remind.data.remindersQueued} reminder(s)
          {remind.data.skippedComplete > 0 ? ` · ${remind.data.skippedComplete} already complete` : ''}
          {remind.data.skippedNoContact > 0
            ? ` · ${remind.data.skippedNoContact} without contact details`
            : ''}
          . They appear under Practice → Messaging.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border-saffron-600 bg-saffron-600 text-white'
                : 'border-line-200 bg-surface-card text-ink-700 hover:bg-surface-sink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={26} />}
          title={requests?.length ? 'Nothing matches that filter' : 'No document requests yet'}
          body={
            requests?.length
              ? 'Try another filter — "All clients" shows every open request.'
              : 'Pick a client and a service, and the checklist builds itself. When they upload, the file is matched to the item it satisfies.'
          }
          action={
            requests?.length
              ? undefined
              : { label: 'Request documents', onClick: () => setDialogOpen(true), icon: <Plus size={16} /> }
          }
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <RequestCard
              key={r._id}
              request={r}
              verifyingKey={verifyingKey}
              onVerify={(requestId, key) => {
                setVerifyingKey(`${requestId}:${key}`);
                verify.mutate({ requestId, key });
              }}
              onRemind={(requestId) => {
                setRemindingId(requestId);
                remind.mutate([requestId]);
              }}
              reminding={remindingId === r._id && remind.isPending}
            />
          ))}
        </ul>
      )}

      <NewRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(payload) => createRequest.mutate(payload)}
        submitting={createRequest.isPending}
        error={createRequest.error as Error | null}
      />
    </div>
  );
}
