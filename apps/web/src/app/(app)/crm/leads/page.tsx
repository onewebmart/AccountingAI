'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FirmService,
  LeadQualificationStatus,
  LeadSource,
  LeadStage,
} from '@ai-accounting/shared';
import { Plus, Send, Sparkles, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SERVICE_LABELS } from '@/lib/crm-labels';
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

interface Qualification {
  status: LeadQualificationStatus;
  score?: number;
  summary?: string;
  signals: string[];
  openQuestions: string[];
  recommendedStage?: LeadStage;
  error?: string;
}

interface Lead {
  _id: string;
  name: string;
  contactName?: string;
  whatsappNumber?: string;
  email?: string;
  source: LeadSource;
  services: FirmService[];
  enquiryNotes?: string;
  estimatedValuePaise?: number;
  stage: LeadStage;
  qualification: Qualification;
}

const SOURCE_LABELS: Record<LeadSource, string> = {
  [LeadSource.WHATSAPP]: 'WhatsApp',
  [LeadSource.WEBSITE]: 'Website',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.WALK_IN]: 'Walk-in',
  [LeadSource.OTHER]: 'Other',
};

const STAGE_LABELS: Record<LeadStage, string> = {
  [LeadStage.NEW]: 'New enquiry',
  [LeadStage.QUALIFYING]: 'Qualifying',
  [LeadStage.PROPOSAL_SENT]: 'Proposal sent',
  [LeadStage.WON]: 'Won',
  [LeadStage.LOST]: 'Lost',
};

/** The three working columns. Won/Lost live in a summary strip, not the board. */
const BOARD_STAGES: LeadStage[] = [LeadStage.NEW, LeadStage.QUALIFYING, LeadStage.PROPOSAL_SENT];

/** Money is integer paise everywhere; only display divides by 100. */
function formatPaise(paise?: number): string {
  if (paise === undefined || paise === null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function ScorePill({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold',
        score >= 70
          ? 'bg-[#E6F4EA] text-[#1E7B34]'
          : score >= 40
            ? 'bg-pending-bg text-pending-fg'
            : 'bg-surface-sink text-ink-500',
      )}
    >
      {score}/100
    </span>
  );
}

function LeadCard({
  lead,
  onQualify,
  onMove,
  busy,
}: {
  lead: Lead;
  onQualify: (id: string) => void;
  onMove: (id: string, stage: LeadStage) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = lead.qualification;
  const queued = q.status === LeadQualificationStatus.QUEUED;
  const done = q.status === LeadQualificationStatus.DONE;

  // Only offer stages that make sense from here — the API enforces the same rules.
  const nextStages: LeadStage[] =
    lead.stage === LeadStage.NEW
      ? [LeadStage.QUALIFYING, LeadStage.PROPOSAL_SENT, LeadStage.LOST]
      : lead.stage === LeadStage.QUALIFYING
        ? [LeadStage.PROPOSAL_SENT, LeadStage.WON, LeadStage.LOST]
        : [LeadStage.WON, LeadStage.LOST, LeadStage.QUALIFYING];

  return (
    <li className="rounded-xl border border-line-200 bg-surface-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-ink-900">{lead.name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {lead.services.length
              ? lead.services.map((s) => SERVICE_LABELS[s]).join(' · ')
              : 'No services specified'}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs font-semibold text-ink-900">
          {formatPaise(lead.estimatedValuePaise)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-surface-sink px-2 py-0.5 text-[11px] text-ink-700">
          {SOURCE_LABELS[lead.source]}
        </span>
        {done && q.score !== undefined ? <ScorePill score={q.score} /> : null}
        {queued ? (
          // Amber = AI work in flight, per the design system.
          <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-[11px] font-semibold text-pending-fg">
            <Sparkles size={10} />
            Qualifying…
          </span>
        ) : null}
        {q.status === LeadQualificationStatus.FAILED ? (
          <span className="rounded-full bg-[#C92A2A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#C92A2A]">
            Qualification failed
          </span>
        ) : null}
      </div>

      {done && q.summary ? (
        <div className="mt-2 rounded-lg bg-honey-50 p-2">
          <p className="text-xs text-ink-700">{q.summary}</p>
          {q.recommendedStage && q.recommendedStage !== lead.stage ? (
            <p className="mt-1.5 text-[11px] text-pending-fg">
              AI suggests moving to <strong>{STAGE_LABELS[q.recommendedStage]}</strong> — your call.
            </p>
          ) : null}
          {open ? (
            <div className="mt-2 space-y-1.5">
              {q.signals.length ? (
                <div>
                  <p className="text-[11px] font-semibold text-ink-500">Signals</p>
                  <ul className="ml-3 list-disc text-[11px] text-ink-700">
                    {q.signals.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {q.openQuestions.length ? (
                <div>
                  <p className="text-[11px] font-semibold text-ink-500">Still to ask</p>
                  <ul className="ml-3 list-disc text-[11px] text-ink-700">
                    {q.openQuestions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {q.signals.length || q.openQuestions.length ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1 text-[11px] font-semibold text-saffron-700 hover:underline"
            >
              {open ? 'Less' : 'Why?'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {!queued ? (
          <button
            type="button"
            onClick={() => onQualify(lead._id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-line-200 px-2 py-1 text-[11px] font-medium text-ink-700 transition-colors hover:bg-surface-sink disabled:opacity-50"
          >
            <Sparkles size={11} />
            {done ? 'Re-qualify' : 'Qualify with AI'}
          </button>
        ) : null}

        <Select onValueChange={(v) => onMove(lead._id, v as LeadStage)}>
          <SelectTrigger className="h-7 w-auto gap-1 border-line-200 px-2 text-[11px]">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {nextStages.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </li>
  );
}

function AddLeadDialog({
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
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [whatsappNumber, setWhatsapp] = useState('');
  const [source, setSource] = useState<LeadSource>(LeadSource.WHATSAPP);
  const [services, setServices] = useState<FirmService[]>([]);
  const [rupees, setRupees] = useState('');
  const [enquiryNotes, setNotes] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { name: name.trim(), source };
    if (contactName.trim()) payload.contactName = contactName.trim();
    if (whatsappNumber.trim()) payload.whatsappNumber = whatsappNumber.replace(/\D/g, '');
    if (services.length) payload.services = services;
    if (enquiryNotes.trim()) payload.enquiryNotes = enquiryNotes.trim();
    // Staff type rupees; the API stores integer paise (Invariant 1).
    const value = Number(rupees.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(value) && value > 0) {
      payload.estimatedValuePaise = Math.round(value * 100);
    }
    onSubmit(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Add lead</DialogTitle>
          <DialogDescription>
            The more of the enquiry you paste in, the better the AI can assess it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lead-name">
              Name <span className="text-[#C92A2A]">*</span>
            </Label>
            <Input
              id="lead-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ratan Steel Works"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-contact">Contact person</Label>
              <Input
                id="lead-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Ratan Gupta"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-wa">WhatsApp number</Label>
              <Input
                id="lead-wa"
                inputMode="numeric"
                value={whatsappNumber}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="9876543210"
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-source">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as LeadSource)}>
                <SelectTrigger id="lead-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(LeadSource).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-value">Estimated annual fee (₹)</Label>
              <Input
                id="lead-value"
                inputMode="decimal"
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                placeholder="25000"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Services wanted</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.values(FirmService).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setServices((cur) =>
                      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
                    )
                  }
                  aria-pressed={services.includes(s)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm transition-colors',
                    services.includes(s)
                      ? 'border-saffron-600 bg-saffron-600 text-white'
                      : 'border-line-200 text-ink-700 hover:bg-surface-sink',
                  )}
                >
                  {SERVICE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-notes">What did they say?</Label>
            <textarea
              id="lead-notes"
              rows={3}
              value={enquiryNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste the WhatsApp message or website enquiry here."
              className="w-full rounded-lg border border-line-200 bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none focus:border-saffron-600"
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
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Adding…' : 'Add lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ['crm', 'leads'],
    queryFn: () => api.get<Lead[]>('/crm/leads'),
    // A queued qualification finishes in a worker, so poll while the board is open.
    refetchInterval: 5000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] });
  };

  const addLead = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/crm/leads', payload),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
    },
  });

  const qualify = useMutation({
    mutationFn: (id: string) => api.post(`/crm/leads/${id}/qualify`),
    onSettled: invalidate,
  });

  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: LeadStage }) =>
      api.post(`/crm/leads/${id}/stage`, { stage }),
    onSettled: invalidate,
  });

  const followUps = useMutation({
    mutationFn: () =>
      api.post<{ nudged: number; skippedNoContact: number }>('/crm/leads/follow-ups/run'),
    onSettled: invalidate,
  });

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const lead of leads ?? []) {
      if (map.has(lead.stage)) map.get(lead.stage)!.push(lead);
    }
    return map;
  }, [leads]);

  const pipelineValue = useMemo(
    () =>
      (leads ?? [])
        .filter((l) => BOARD_STAGES.includes(l.stage))
        .reduce((sum, l) => sum + (l.estimatedValuePaise ?? 0), 0),
    [leads],
  );

  const activeCount = (leads ?? []).filter((l) => BOARD_STAGES.includes(l.stage)).length;
  const won = (leads ?? []).filter((l) => l.stage === LeadStage.WON).length;
  const lost = (leads ?? []).filter((l) => l.stage === LeadStage.LOST).length;

  return (
    <div>
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-900">Leads</h1>
            <p className="mt-1 text-sm text-ink-500">
              Enquiries from every channel. The AI scores and summarises them; moving a lead
              is always your call.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => followUps.mutate()}
              disabled={followUps.isPending}
            >
              <Send size={16} />
              {followUps.isPending ? 'Queueing…' : 'Run follow-ups'}
            </Button>
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus size={16} />
              Add lead
            </Button>
          </div>
        </div>
      </FadeIn>

      {followUps.isSuccess ? (
        <p className="mb-4 rounded-lg bg-[#E6F4EA] px-3 py-2 text-sm text-[#1E7B34]">
          Nudged {followUps.data.nudged} lead(s)
          {followUps.data.skippedNoContact > 0
            ? ` · ${followUps.data.skippedNoContact} without contact details`
            : ''}
          . They appear under Practice → Messaging.
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-ink-900">{activeCount}</p>
          <p className="text-xs text-ink-500">Active leads</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-saffron-700">
            {formatPaise(pipelineValue)}
          </p>
          <p className="text-xs text-ink-500">Pipeline value</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-[#1E7B34]">{won}</p>
          <p className="text-xs text-ink-500">Won</p>
        </div>
        <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
          <p className="font-mono text-xl font-bold text-ink-400">{lost}</p>
          <p className="text-xs text-ink-500">Lost</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : activeCount === 0 ? (
        <EmptyState
          icon={<TrendingUp size={26} />}
          title="No active leads"
          body="Paste in an enquiry and the AI reads it, scores the fit and lists what you still need to ask — before you spend an hour on it."
          action={{ label: 'Add lead', onClick: () => setDialogOpen(true), icon: <Plus size={16} /> }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {BOARD_STAGES.map((stage) => {
            const column = byStage.get(stage) ?? [];
            return (
              <section key={stage}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="font-heading text-sm font-semibold text-ink-900">
                    {STAGE_LABELS[stage]}
                  </h2>
                  <span className="font-mono text-xs text-ink-400">{column.length}</span>
                </div>
                <ul className="space-y-2">
                  {column.map((lead) => (
                    <LeadCard
                      key={lead._id}
                      lead={lead}
                      onQualify={(id) => qualify.mutate(id)}
                      onMove={(id, s) => move.mutate({ id, stage: s })}
                      busy={qualify.isPending || move.isPending}
                    />
                  ))}
                  {column.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-line-200 px-3 py-8 text-center text-xs text-ink-400">
                      Nothing here
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {move.error ? (
        <p className="mt-4 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
          {(move.error as Error).message}
        </p>
      ) : null}

      <AddLeadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(payload) => addLead.mutate(payload)}
        submitting={addLead.isPending}
        error={addLead.error as Error | null}
      />
    </div>
  );
}
