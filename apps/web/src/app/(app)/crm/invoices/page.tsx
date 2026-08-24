'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FirmService, PracticeInvoiceStatus } from '@ai-accounting/shared';
import { IndianRupee, Plus, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Client, SERVICE_LABELS } from '@/lib/crm-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Invoice {
  _id: string;
  clientName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalPaise: number;
  paidPaise: number;
  status: PracticeInvoiceStatus;
  lines: { description: string; service?: FirmService; amountPaise: number }[];
}

interface Ageing {
  totalBilledPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  buckets: {
    notYetDuePaise: number;
    days0to30Paise: number;
    days31to60Paise: number;
    days61to90Paise: number;
    over90Paise: number;
  };
}

/** Money is integer paise everywhere; only display divides by 100. */
function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function daysLate(dueDate: string): number {
  return Math.round(
    (Date.now() - new Date(`${dueDate}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

const STATUS_STYLES: Record<PracticeInvoiceStatus, string> = {
  [PracticeInvoiceStatus.DRAFT]: 'bg-surface-sink text-ink-500',
  [PracticeInvoiceStatus.SENT]: 'bg-honey-100 text-ink-700',
  [PracticeInvoiceStatus.PARTIALLY_PAID]: 'bg-pending-bg text-pending-fg',
  [PracticeInvoiceStatus.PAID]: 'bg-[#E6F4EA] text-[#1E7B34]',
  [PracticeInvoiceStatus.OVERDUE]: 'bg-[#C92A2A]/10 text-[#C92A2A]',
  [PracticeInvoiceStatus.LEGAL_NOTICE]: 'bg-[#C92A2A] text-white',
  [PracticeInvoiceStatus.CANCELLED]: 'bg-surface-sink text-ink-400 line-through',
};

const STATUS_LABELS: Record<PracticeInvoiceStatus, string> = {
  [PracticeInvoiceStatus.DRAFT]: 'Draft',
  [PracticeInvoiceStatus.SENT]: 'Sent',
  [PracticeInvoiceStatus.PARTIALLY_PAID]: 'Part paid',
  [PracticeInvoiceStatus.PAID]: 'Paid',
  [PracticeInvoiceStatus.OVERDUE]: 'Overdue',
  [PracticeInvoiceStatus.LEGAL_NOTICE]: 'Legal notice',
  [PracticeInvoiceStatus.CANCELLED]: 'Cancelled',
};

function AgeingStrip({ ageing }: { ageing: Ageing }) {
  const cells = [
    { label: 'Not yet due', value: ageing.buckets.notYetDuePaise, tone: 'text-ink-700' },
    { label: '0–30 days', value: ageing.buckets.days0to30Paise, tone: 'text-pending-fg' },
    { label: '31–60 days', value: ageing.buckets.days31to60Paise, tone: 'text-pending-fg' },
    { label: '61–90 days', value: ageing.buckets.days61to90Paise, tone: 'text-[#C92A2A]' },
    { label: 'Over 90 days', value: ageing.buckets.over90Paise, tone: 'text-[#C92A2A]' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3">
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-ink-900">
            {formatPaise(ageing.totalBilledPaise)}
          </p>
          <p className="text-xs text-ink-500">Billed</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-[#1E7B34]">
            {formatPaise(ageing.collectedPaise)}
          </p>
          <p className="text-xs text-ink-500">Collected</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-saffron-700">
            {formatPaise(ageing.outstandingPaise)}
          </p>
          <p className="text-xs text-ink-500">Outstanding</p>
        </div>
      </div>

      <div className="mb-5 grid gap-2 rounded-xl border border-line-200 bg-surface-card p-3 sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label}>
            <p className={cn('font-mono text-sm font-semibold', c.tone)}>{formatPaise(c.value)}</p>
            <p className="text-[11px] text-ink-500">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewInvoiceDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  submitting: boolean;
  error: Error | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [clientOrgId, setClientOrgId] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [service, setService] = useState<FirmService | ''>('');
  const [rupees, setRupees] = useState('');

  const { data: clients } = useQuery<Client[]>({
    queryKey: ['firm', 'clients'],
    queryFn: () => api.get<Client[]>('/firm/clients'),
    enabled: open,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(rupees.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) return;

    onSubmit({
      clientOrgId,
      issueDate,
      dueDate,
      lines: [
        {
          description: description.trim(),
          ...(service ? { service } : {}),
          // Staff type rupees; the API stores integer paise (Invariant 1).
          amountPaise: Math.round(value * 100),
        },
      ],
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Raise invoice</DialogTitle>
          <DialogDescription>
            The number is allocated when you save, and is gapless per financial year.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inv-client">Client</Label>
            <Select value={clientOrgId || undefined} onValueChange={setClientOrgId}>
              <SelectTrigger id="inv-client">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-issue">Issue date</Label>
              <Input
                id="inv-issue"
                type="date"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-desc">Description</Label>
            <Input
              id="inv-desc"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="GST filing — August 2026"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-service">Service (optional)</Label>
              <Select value={service || undefined} onValueChange={(v) => setService(v as FirmService)}>
                <SelectTrigger id="inv-service">
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
              <Label htmlFor="inv-amount">Amount (₹)</Label>
              <Input
                id="inv-amount"
                inputMode="decimal"
                required
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                placeholder="48000"
                className="font-mono"
              />
            </div>
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
            <Button
              type="submit"
              disabled={submitting || !clientOrgId || !dueDate || !description.trim() || !rupees}
            >
              {submitting ? 'Raising…' : 'Raise invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ['crm', 'invoices'],
    queryFn: () => api.get<Invoice[]>('/crm/invoices'),
  });

  const { data: ageing } = useQuery<Ageing>({
    queryKey: ['crm', 'invoices', 'ageing'],
    queryFn: () => api.get<Ageing>('/crm/invoices/ageing'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] });
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/crm/invoices', payload),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
    },
  });

  const issue = useMutation({
    mutationFn: (id: string) => api.post(`/crm/invoices/${id}/issue`),
    onSettled: invalidate,
  });

  const pay = useMutation({
    mutationFn: ({ id, amountPaise }: { id: string; amountPaise: number }) =>
      api.post(`/crm/invoices/${id}/payments`, {
        amountPaise,
        receivedOn: new Date().toISOString().slice(0, 10),
      }),
    onSettled: () => {
      setPayingId(null);
      setPayAmount('');
      invalidate();
    },
  });

  const collections = useMutation({
    mutationFn: () =>
      api.post<{ remindersQueued: number; skippedNoContact: number; escalated: number }>(
        '/crm/invoices/collections/run',
      ),
    onSettled: invalidate,
  });

  const outstanding = useMemo(
    () =>
      (invoices ?? []).filter(
        (i) =>
          i.status !== PracticeInvoiceStatus.PAID &&
          i.status !== PracticeInvoiceStatus.CANCELLED,
      ),
    [invoices],
  );

  return (
    <div>
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-900">Invoices</h1>
            <p className="mt-1 text-sm text-ink-500">
              Your own fee billing and what is still owed. Reminders climb a ladder: seven days
              before, on the due date, then a week and a fortnight late.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => collections.mutate()}
              disabled={collections.isPending}
            >
              <Send size={16} />
              {collections.isPending ? 'Queueing…' : 'Run collections'}
            </Button>
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus size={16} />
              Raise invoice
            </Button>
          </div>
        </div>
      </FadeIn>

      {collections.isSuccess ? (
        <p className="mb-4 rounded-lg bg-[#E6F4EA] px-3 py-2 text-sm text-[#1E7B34]">
          Queued {collections.data.remindersQueued} reminder(s)
          {collections.data.escalated > 0
            ? ` · ${collections.data.escalated} flagged for legal escalation`
            : ''}
          {collections.data.skippedNoContact > 0
            ? ` · ${collections.data.skippedNoContact} without contact details`
            : ''}
          .
        </p>
      ) : null}
      {pay.error || issue.error ? (
        <p className="mb-4 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
          {((pay.error ?? issue.error) as Error).message}
        </p>
      ) : null}

      {ageing ? <AgeingStrip ageing={ageing} /> : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : outstanding.length === 0 ? (
        <EmptyState
          icon={<IndianRupee size={26} />}
          title={invoices?.length ? 'Everything is settled' : 'No invoices yet'}
          body={
            invoices?.length
              ? 'Nothing outstanding right now. New invoices appear here the moment you issue them.'
              : 'Raise a fee invoice and the number is allocated for you — gapless, per financial year. Reminders then climb on their own.'
          }
          action={
            invoices?.length
              ? undefined
              : { label: 'Raise invoice', onClick: () => setDialogOpen(true), icon: <Plus size={16} /> }
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line-200 bg-surface-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstanding.map((inv) => {
                const balance = inv.totalPaise - inv.paidPaise;
                const late = daysLate(inv.dueDate);
                return (
                  <TableRow key={inv._id}>
                    <TableCell className="font-mono text-xs text-ink-900">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-sm text-ink-900">{inv.clientName}</TableCell>
                    <TableCell className="text-sm text-ink-700">
                      {formatDate(inv.dueDate)}
                      {late > 0 && inv.status !== PracticeInvoiceStatus.DRAFT ? (
                        <span className="ml-1 text-[11px] text-[#C92A2A]">({late}d late)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-ink-700">
                      {formatPaise(inv.totalPaise)}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold text-ink-900">
                      {formatPaise(balance)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          STATUS_STYLES[inv.status],
                        )}
                      >
                        {STATUS_LABELS[inv.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      {inv.status === PracticeInvoiceStatus.DRAFT ? (
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => issue.mutate(inv._id)}
                          disabled={issue.isPending}
                        >
                          Issue
                        </Button>
                      ) : payingId === inv._id ? (
                        <span className="flex items-center gap-1">
                          <Input
                            autoFocus
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            placeholder={String(balance / 100)}
                            className="h-7 w-24 font-mono text-xs"
                          />
                          <Button
                            className="h-7 px-2 text-xs"
                            disabled={pay.isPending}
                            onClick={() => {
                              const value = Number(payAmount.replace(/[^0-9.]/g, ''));
                              if (!Number.isFinite(value) || value <= 0) return;
                              pay.mutate({ id: inv._id, amountPaise: Math.round(value * 100) });
                            }}
                          >
                            Save
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => setPayingId(inv._id)}
                        >
                          Record payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <NewInvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(payload) => create.mutate(payload)}
        submitting={create.isPending}
        error={create.error as Error | null}
      />
    </div>
  );
}
