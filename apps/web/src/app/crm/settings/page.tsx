'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageChannel,
  MessageStatus,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { AlertTriangle, Mail, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FadeIn } from '@/components/motion/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Template {
  key: MessageTemplateKey;
  label: string;
  description: string;
  subject?: string;
  body: string;
  variables: string[];
  channels: MessageChannel[];
}

interface Message {
  _id: string;
  channel: MessageChannel;
  status: MessageStatus;
  recipientName?: string;
  recipientAddress: string;
  templateKey?: MessageTemplateKey;
  subject?: string;
  body: string;
  isMock: boolean;
  error?: string;
  sentAt?: string;
  createdAt: string;
}

const STATUS_STYLES: Record<MessageStatus, string> = {
  // Amber = pending, green = done, cool red = error (design system).
  [MessageStatus.QUEUED]: 'bg-pending-bg text-pending-fg',
  [MessageStatus.SENT]: 'bg-[#E6F4EA] text-[#1E7B34]',
  [MessageStatus.FAILED]: 'bg-[#C92A2A]/10 text-[#C92A2A]',
};

function ChannelIcon({ channel }: { channel: MessageChannel }) {
  return channel === MessageChannel.WHATSAPP ? (
    <MessageSquare size={14} className="text-ink-500" />
  ) : (
    <Mail size={14} className="text-ink-500" />
  );
}

// ── Outbox ────────────────────────────────────────────────────────────────────

function Outbox() {
  const [statusFilter, setStatusFilter] = useState<MessageStatus | 'ALL'>('ALL');
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: ['crm', 'messages'],
    queryFn: () => api.get<Message[]>('/crm/messaging/messages?limit=100'),
    // Queued messages become SENT in a worker, so poll while the tab is open.
    refetchInterval: 5000,
  });

  const filtered = (messages ?? []).filter(
    (m) => statusFilter === 'ALL' || m.status === statusFilter,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['ALL', ...Object.values(MessageStatus)] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s as MessageStatus | 'ALL')}
              aria-pressed={statusFilter === s}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === s
                  ? 'border-saffron-600 bg-saffron-600 text-white'
                  : 'border-line-200 bg-surface-card text-ink-700 hover:bg-surface-sink',
              )}
            >
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] })}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-14 text-center">
          <Send size={28} className="mx-auto text-ink-400" />
          <p className="mt-3 font-heading text-lg font-semibold text-ink-900">
            {messages?.length ? 'Nothing with that status' : 'No messages yet'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {messages?.length
              ? 'Try a different status filter.'
              : 'Send a test message from the Delivery tab to see the queue working.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => (
            <li
              key={m._id}
              className="rounded-xl border border-line-200 bg-surface-card p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <ChannelIcon channel={m.channel} />
                <span className="font-medium text-ink-900">
                  {m.recipientName ?? m.recipientAddress}
                </span>
                <span className="font-mono text-[11px] text-ink-400">
                  {m.recipientAddress}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    STATUS_STYLES[m.status],
                  )}
                >
                  {m.status}
                </span>
                {m.isMock && m.status === MessageStatus.SENT ? (
                  // Nobody should mistake a mock send for a real delivery.
                  <span className="rounded-full bg-surface-sink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    Mock
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[11px] text-ink-400">
                  {new Date(m.sentAt ?? m.createdAt).toLocaleString('en-IN')}
                </span>
              </div>

              {m.subject ? (
                <p className="mb-1 text-sm font-medium text-ink-700">{m.subject}</p>
              ) : null}
              <pre className="whitespace-pre-wrap font-body text-sm text-ink-700">{m.body}</pre>

              {m.error ? (
                <p className="mt-2 flex items-start gap-2 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {m.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

function Templates() {
  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['crm', 'templates'],
    queryFn: () => api.get<Template[]>('/crm/messaging/templates'),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-500">
        Client-facing copy is Hinglish by design — the person reading a reminder is the
        client, not your team. Editing these per firm arrives in a later phase.
      </p>
      <ul className="space-y-3">
        {(templates ?? []).map((t) => (
          <li key={t.key} className="rounded-xl border border-line-200 bg-surface-card p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-heading font-semibold text-ink-900">{t.label}</span>
              <span className="font-mono text-[11px] text-ink-400">{t.key}</span>
              <div className="ml-auto flex gap-1">
                {t.channels.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-surface-sink px-2 py-0.5 text-[11px] text-ink-700"
                  >
                    {c === MessageChannel.WHATSAPP ? 'WhatsApp' : 'Email'}
                  </span>
                ))}
              </div>
            </div>
            <p className="mb-3 text-sm text-ink-500">{t.description}</p>
            {t.subject ? (
              <p className="mb-1 text-sm text-ink-700">
                <span className="text-ink-400">Subject: </span>
                {t.subject}
              </p>
            ) : null}
            <pre className="whitespace-pre-wrap rounded-lg bg-surface-sink p-3 font-body text-sm text-ink-700">
              {t.body}
            </pre>
            <p className="mt-2 flex flex-wrap gap-1 text-[11px] text-ink-400">
              Variables:
              {t.variables.map((v) => (
                <span key={v} className="font-mono text-ink-500">
                  {v}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Delivery + test send ──────────────────────────────────────────────────────

function Delivery() {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<MessageChannel>(MessageChannel.WHATSAPP);
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('Namaste! Ye ek test message hai.');

  const send = useMutation({
    mutationFn: () =>
      api.post('/crm/messaging/messages', {
        channel,
        templateKey: MessageTemplateKey.GENERIC,
        recipientAddress: to.trim(),
        recipientName: name.trim() || undefined,
        variables: { body: text },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] });
      setTo('');
      setName('');
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-line-200 bg-surface-card p-5">
        <h3 className="font-heading font-semibold text-ink-900">Delivery adapter</h3>
        <p className="mt-1 text-sm text-ink-500">
          Currently <span className="font-mono text-ink-700">mock</span>. Messages are
          rendered, queued and recorded in the outbox, but nothing leaves this machine — so
          the whole reminder flow is testable without a WhatsApp Business account or SMTP
          credentials. Swapping in a real adapter changes one line and no business logic.
        </p>
      </div>

      <form
        className="rounded-xl border border-line-200 bg-surface-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <h3 className="font-heading font-semibold text-ink-900">Send a test message</h3>
        <p className="mb-4 mt-1 text-sm text-ink-500">
          Goes through the real queue and lands in the outbox.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="channel">Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as MessageChannel)}>
              <SelectTrigger id="channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MessageChannel.WHATSAPP}>WhatsApp</SelectItem>
                <SelectItem value={MessageChannel.EMAIL}>Email</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="to">
              {channel === MessageChannel.WHATSAPP ? 'WhatsApp number' : 'Email address'}
            </Label>
            <Input
              id="to"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={
                channel === MessageChannel.WHATSAPP ? '9876543210' : 'ramesh@example.in'
              }
              className="font-mono"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="name">Recipient name (optional)</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ramesh Mehta"
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="text">Message</Label>
          <textarea
            id="text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-line-200 bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none focus:border-saffron-600"
          />
        </div>

        {send.error ? (
          <p className="mt-3 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
            {(send.error as Error).message}
          </p>
        ) : null}
        {send.isSuccess ? (
          <p className="mt-3 rounded-lg bg-[#E6F4EA] px-3 py-2 text-sm text-[#1E7B34]">
            Queued — check the Outbox tab.
          </p>
        ) : null}

        <Button
          type="submit"
          className="mt-4 gap-2"
          disabled={send.isPending || !to.trim() || !text.trim()}
        >
          <Send size={16} />
          {send.isPending ? 'Queueing…' : 'Send test message'}
        </Button>
      </form>
    </div>
  );
}

export default function CrmSettingsPage() {
  return (
    <div>
      <FadeIn>
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-ink-900">Settings</h1>
          <p className="mt-1 text-sm text-ink-500">
            Messaging templates, delivery adapter and the outbox.
          </p>
        </div>
      </FadeIn>

      <Tabs defaultValue="outbox">
        <TabsList className="mb-5">
          <TabsTrigger value="outbox">Outbox</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
        </TabsList>

        <TabsContent value="outbox">
          <Outbox />
        </TabsContent>
        <TabsContent value="templates">
          <Templates />
        </TabsContent>
        <TabsContent value="delivery">
          <Delivery />
        </TabsContent>
      </Tabs>
    </div>
  );
}
