'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationStatus,
  EscalationReason,
  MessageChannel,
  MessageDirection,
} from '@ai-accounting/shared';
import { AlertTriangle, Bot, Send, ShieldCheck, User } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/motion/primitives';

interface Conversation {
  _id: string;
  contactName?: string;
  contactAddress: string;
  channel: MessageChannel;
  status: ConversationStatus;
  escalation?: { reason: EscalationReason; triggeredBy?: string; escalatedAt: string };
  inboundCount: number;
  autoRepliedCount: number;
  topics: string[];
  lastInboundAt?: string;
}

interface Message {
  _id: string;
  direction: MessageDirection;
  body: string;
  createdAt: string;
  templateKey?: string;
}

interface Stats {
  inboundTotal: number;
  autoRepliedTotal: number;
  autoResolveRate: number;
  avgResponseSeconds: number;
  escalatedOpen: number;
  topFaqs: { topic: string; count: number }[];
}

const ESCALATION_LABELS: Record<EscalationReason, string> = {
  [EscalationReason.COMMERCIAL]: 'Fees or pricing',
  [EscalationReason.SENSITIVE]: 'Sensitive matter',
  [EscalationReason.CLIENT_REQUESTED]: 'Client asked for a person',
  [EscalationReason.LOW_CONFIDENCE]: 'Agent unsure',
  [EscalationReason.AGENT_ERROR]: 'Agent failed',
  [EscalationReason.MANUAL]: 'Taken over manually',
};

function StatsPanel({ stats }: { stats: Stats }) {
  return (
    <div className="mb-5 flex flex-wrap gap-3">
      <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
        <p className="font-mono text-xl font-bold text-[#1E7B34]">{stats.autoResolveRate}%</p>
        <p className="text-xs text-ink-500">Auto-resolve rate</p>
      </div>
      <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
        <p className="font-mono text-xl font-bold text-ink-900">
          {stats.avgResponseSeconds > 0 ? `${stats.avgResponseSeconds}s` : '—'}
        </p>
        <p className="text-xs text-ink-500">Avg response</p>
      </div>
      <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
        <p className="font-mono text-xl font-bold text-ink-900">{stats.inboundTotal}</p>
        <p className="text-xs text-ink-500">Messages received</p>
      </div>
      <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
        <p className="font-mono text-xl font-bold text-pending-fg">{stats.escalatedOpen}</p>
        <p className="text-xs text-ink-500">Waiting on you</p>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sender, setSender] = useState('9876543210');
  const endRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading } = useQuery<Conversation[]>({
    queryKey: ['crm', 'conversations'],
    queryFn: () => api.get<Conversation[]>('/crm/agent/conversations'),
    refetchInterval: 4000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ['crm', 'agent', 'stats'],
    queryFn: () => api.get<Stats>('/crm/agent/stats'),
    refetchInterval: 8000,
  });

  const active = selectedId ?? conversations?.[0]?._id ?? null;

  const { data: thread } = useQuery<{ conversation: Conversation; messages: Message[] }>({
    queryKey: ['crm', 'conversations', active],
    queryFn: () => api.get(`/crm/agent/conversations/${active}`),
    enabled: Boolean(active),
    refetchInterval: 4000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages.length]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'agent', 'stats'] });
  };

  const sendInbound = useMutation({
    mutationFn: (text: string) =>
      api.post('/crm/agent/inbound', {
        channel: MessageChannel.WHATSAPP,
        from: sender,
        text,
      }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/crm/agent/conversations/${id}/resolve`),
    onSettled: invalidate,
  });

  const current = thread?.conversation;
  const escalated = current?.status === ConversationStatus.ESCALATED;

  return (
    <div>
      <FadeIn>
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-ink-900">Support agent</h1>
          <p className="mt-1 text-sm text-ink-500">
            Client questions answered automatically from their real records. Anything about fees,
            anything sensitive, and anything the agent is unsure of comes to you instead.
          </p>
        </div>
      </FadeIn>

      {stats ? <StatsPanel stats={stats} /> : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Threads */}
        <aside>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Conversations
          </p>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (conversations ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-200 px-3 py-8 text-center text-xs text-ink-400">
              No conversations yet
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(conversations ?? []).map((c) => (
                <li key={c._id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c._id)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                      active === c._id
                        ? 'border-saffron-600 bg-honey-100'
                        : 'border-line-200 bg-surface-card hover:bg-surface-sink',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-900">
                        {c.contactName ?? c.contactAddress}
                      </span>
                      {c.status === ConversationStatus.ESCALATED ? (
                        <span className="shrink-0 rounded-full bg-pending-bg px-1.5 py-0.5 text-[10px] font-semibold text-pending-fg">
                          You
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
                      {c.contactAddress}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section className="rounded-xl border border-line-200 bg-surface-card">
          {escalated && current?.escalation ? (
            <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-pending-fg/20 bg-pending-bg px-4 py-2.5">
              <AlertTriangle size={15} className="text-pending-fg" />
              <span className="text-sm font-medium text-pending-fg">
                Waiting on you — {ESCALATION_LABELS[current.escalation.reason]}
              </span>
              <Button
                variant="secondary"
                className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => resolve.mutate(current._id)}
                disabled={resolve.isPending}
              >
                <ShieldCheck size={13} />
                {resolve.isPending ? 'Handing back…' : 'Hand back to agent'}
              </Button>
            </div>
          ) : null}

          <div className="max-h-[420px] min-h-[240px] overflow-y-auto p-4">
            {!thread ? (
              <p className="py-16 text-center text-sm text-ink-400">
                Select a conversation, or send a test message below.
              </p>
            ) : (
              <ul className="space-y-3">
                {thread.messages.map((m) => {
                  const fromClient = m.direction === MessageDirection.INBOUND;
                  return (
                    <li
                      key={m._id}
                      className={cn('flex gap-2', fromClient ? 'justify-start' : 'justify-end')}
                    >
                      {fromClient ? (
                        <User size={14} className="mt-2 shrink-0 text-ink-400" />
                      ) : null}
                      <div
                        className={cn(
                          'max-w-[75%] rounded-xl px-3 py-2',
                          fromClient
                            ? 'bg-surface-sink text-ink-900'
                            : 'bg-saffron-600 text-white',
                        )}
                      >
                        <pre className="whitespace-pre-wrap font-body text-sm">{m.body}</pre>
                        <p
                          className={cn(
                            'mt-1 text-[10px]',
                            fromClient ? 'text-ink-400' : 'text-white/70',
                          )}
                        >
                          {fromClient ? 'Client' : 'Agent'} ·{' '}
                          {new Date(m.createdAt).toLocaleTimeString('en-IN')}
                        </p>
                      </div>
                      {!fromClient ? (
                        <Bot size={14} className="mt-2 shrink-0 text-saffron-600" />
                      ) : null}
                    </li>
                  );
                })}
                <div ref={endRef} />
              </ul>
            )}
          </div>

          {/* Simulate an inbound message — the mock adapter's stand-in for WhatsApp. */}
          <form
            className="flex flex-wrap items-center gap-2 border-t border-line-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) sendInbound.mutate(draft.trim());
            }}
          >
            <Input
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              className="h-9 w-32 font-mono text-xs"
              aria-label="Sender number"
            />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type as the client — e.g. GSTR-3B kab bharna hai?"
              className="h-9 flex-1"
              aria-label="Client message"
            />
            <Button
              type="submit"
              className="h-9 gap-1.5"
              disabled={sendInbound.isPending || !draft.trim()}
            >
              <Send size={14} />
              {sendInbound.isPending ? 'Sending…' : 'Send as client'}
            </Button>
          </form>
          {sendInbound.error ? (
            <p className="px-3 pb-3 text-sm text-[#C92A2A]">
              {(sendInbound.error as Error).message}
            </p>
          ) : null}
        </section>
      </div>

      {stats?.topFaqs.length ? (
        <div className="mt-5 rounded-xl border border-line-200 bg-surface-card p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold text-ink-900">
            What clients keep asking
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {stats.topFaqs.map((f) => (
              <li
                key={f.topic}
                className="rounded-lg bg-surface-sink px-2.5 py-1 text-xs text-ink-700"
              >
                {f.topic}
                <span className="ml-1.5 font-mono text-[11px] text-ink-400">{f.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
