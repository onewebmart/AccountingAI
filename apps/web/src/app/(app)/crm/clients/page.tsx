'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FirmService } from '@ai-accounting/shared';
import { Plus, Search, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Client, CLIENT_TYPE_LABELS, SERVICE_LABELS } from '@/lib/crm-labels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/motion/primitives';
import { EmptyState } from '@/components/crm/empty-state';
import { ListStagger } from '@/components/crm/list-stagger';
import { AddClientDialog } from './add-client-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function ServicePill({ service }: { service: FirmService }) {
  return (
    <span className="rounded-md bg-surface-sink px-2 py-0.5 text-[11px] font-medium text-ink-700">
      {SERVICE_LABELS[service]}
    </span>
  );
}

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState<FirmService | 'ALL'>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    data: clients,
    isLoading,
    error,
  } = useQuery<Client[]>({
    queryKey: ['firm', 'clients'],
    queryFn: () => api.get<Client[]>('/firm/clients'),
  });

  const addClient = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Client>('/firm/clients', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['firm', 'clients'] });
      setDialogOpen(false);
    },
  });

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.gstin?.toLowerCase().includes(q) ||
        c.pan?.toLowerCase().includes(q) ||
        c.contactName?.toLowerCase().includes(q);
      const matchesService =
        serviceFilter === 'ALL' || (c.services ?? []).includes(serviceFilter);
      return matchesSearch && matchesService;
    });
  }, [clients, search, serviceFilter]);

  return (
    <div>
      {/* Header */}
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-h1 text-ink-900">Clients</h1>
            <p className="mt-1 text-body text-ink-500">
              Every client your firm manages, their services and contact details.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus size={16} />
            Add client
          </Button>
        </div>
      </FadeIn>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, GSTIN, PAN or contact"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['ALL', ...Object.values(FirmService)] as const).map((s) => {
            const active = serviceFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setServiceFilter(s as FirmService | 'ALL')}
                aria-pressed={active}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-caption font-medium transition-colors',
                  active
                    ? 'border-saffron-600 bg-saffron-600 text-white'
                    : 'border-line-200 bg-surface-card text-ink-700 hover:bg-surface-sink',
                )}
              >
                {s === 'ALL' ? 'All services' : SERVICE_LABELS[s as FirmService]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#C92A2A]/30 bg-[#C92A2A]/5 p-6">
          <p className="font-medium text-[#C92A2A]">Couldn&apos;t load clients</p>
          <p className="mt-1 text-body text-ink-500">
            {error instanceof ApiError && error.status === 403
              ? 'This account is not a firm admin, so it has no client book.'
              : (error as Error).message}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={26} />}
          title={clients?.length ? 'No clients match those filters' : 'No clients yet'}
          body={
            clients?.length
              ? 'Try a different search term, or clear the service filter to see everyone.'
              : 'Add a client with the services you handle for them, and their statutory deadlines appear automatically.'
          }
          action={
            clients?.length
              ? undefined
              : { label: 'Add client', onClick: () => setDialogOpen(true), icon: <Plus size={16} /> }
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line-200 bg-surface-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c._id}>
                  <TableCell>
                    <p className="font-medium text-ink-900">{c.name}</p>
                    {c.gstin ? (
                      <p className="font-mono text-[11px] text-ink-400">GST: {c.gstin}</p>
                    ) : c.pan ? (
                      <p className="font-mono text-[11px] text-ink-400">PAN: {c.pan}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-body text-ink-700">
                    {c.clientType ? CLIENT_TYPE_LABELS[c.clientType] : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(c.services ?? []).length ? (
                        c.services!.map((s) => <ServicePill key={s} service={s} />)
                      ) : (
                        <span className="text-body text-ink-400">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-body text-ink-700">
                    {c.contactName ? <p>{c.contactName}</p> : null}
                    {c.whatsappNumber ? (
                      <p className="font-mono text-[11px] text-ink-400">{c.whatsappNumber}</p>
                    ) : null}
                    {!c.contactName && !c.whatsappNumber ? (
                      <span className="text-ink-400">—</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        c.isActive
                          ? 'bg-[#E6F4EA] text-[#1E7B34]'
                          : 'bg-surface-sink text-ink-500',
                      )}
                    >
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(payload) => addClient.mutate(payload)}
        submitting={addClient.isPending}
        error={addClient.error as Error | null}
      />
    </div>
  );
}
