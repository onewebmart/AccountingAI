'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Mail, MessageCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface InboxAddress {
  address: string | null;
  token: string;
  configured: boolean;
}

interface LinkedNumbers {
  senders: string[];
  configured: boolean;
}

interface LinkCode {
  /** What to send from the phone: "LINK AB2C3D". */
  text: string;
  expiresAt: string;
  businessNumber: string | null;
}

type FileStatus = 'accepted' | 'duplicate' | 'rejected' | 'skipped';

interface InboundMessageRow {
  _id: string;
  channel: 'email' | 'whatsapp';
  from: string | null;
  fromName: string | null;
  knownSender: boolean;
  subject: string | null;
  createdAt: string;
  files: Array<{ fileName: string; status: FileStatus; reason: string | null }>;
}

/** 919876543210 → +91 98765 43210. Other countries are left as digits after the +. */
export function formatPhone(digits: string): string {
  return digits.length === 12 && digits.startsWith('91') ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`;
}

const FILE_STATUS: Record<FileStatus, { label: string; className: string }> = {
  accepted: { label: 'Sent for reading', className: 'bg-info-bg text-info-fg' },
  duplicate: { label: 'Duplicate?', className: 'bg-pending-bg text-pending-fg' },
  rejected: { label: 'Not taken', className: 'bg-error-bg text-error-fg' },
  skipped: { label: 'Skipped', className: 'bg-surface-sink text-ink-500' },
};

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/**
 * Bills sent in rather than uploaded: the org's forwarding address, the
 * WhatsApp numbers whose files are filed here, and what arrived lately.
 * Everything sent in waits in the Inbox like an upload; nothing posts itself.
 */
export function SentInPanel() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<(LinkCode & { before: number }) | null>(null);
  const [showAll, setShowAll] = useState(false);

  const address = useQuery({ queryKey: ['inbox', 'address'], queryFn: () => api.get<InboxAddress>('/inbox/address') });
  const numbers = useQuery({
    queryKey: ['inbox', 'whatsapp'],
    queryFn: () => api.get<LinkedNumbers>('/inbox/whatsapp-senders'),
    // While a code is out, watch for the phone to send it.
    refetchInterval: (query) =>
      pending && new Date(pending.expiresAt).getTime() > Date.now() && (query.state.data?.senders.length ?? 0) <= pending.before ? 4000 : false,
  });
  const linkedCount = numbers.data?.senders.length ?? 0;
  const codeLive = pending && new Date(pending.expiresAt).getTime() > Date.now() && linkedCount <= pending.before;
  const messages = useQuery({
    queryKey: ['inbox', 'messages'],
    queryFn: () => api.get<InboundMessageRow[]>('/inbox/messages'),
    refetchInterval: 30_000,
  });

  const rotate = useMutation({
    mutationFn: () => api.post<InboxAddress>('/inbox/address/rotate'),
    onSuccess: (next) => queryClient.setQueryData(['inbox', 'address'], next),
  });
  const link = useMutation({
    mutationFn: () => api.post<LinkCode>('/inbox/whatsapp-senders/code'),
    onSuccess: (code) => setPending({ ...code, before: linkedCount }),
  });
  const unlink = useMutation({
    mutationFn: (value: string) => api.post<LinkedNumbers>('/inbox/whatsapp-senders/remove', { phone: value }),
    onSuccess: (next) => queryClient.setQueryData(['inbox', 'whatsapp'], next),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is on screen to select by hand.
    }
  };

  const rows = messages.data ?? [];
  const shown = showAll ? rows : rows.slice(0, 5);

  return (
    <section className="rounded-xl border border-line-200 bg-surface-card">
      <div className="grid gap-px bg-line-200 md:grid-cols-2">
        {/* Email */}
        <div className="space-y-2 bg-surface-card p-4">
          <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-ink-500">
            <Mail size={13} /> Forward bills by email
          </p>
          {address.isError ? (
            <p className="text-caption text-error-fg">{message(address.error)}</p>
          ) : !address.data ? (
            <p className="text-caption text-ink-400">Loading…</p>
          ) : !address.data.configured || !address.data.address ? (
            <p className="text-caption text-ink-500">Email-in is not set up on this server yet. Ask whoever runs it to add an inbound mail domain.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-surface-sink px-2 py-1 font-mono text-caption text-ink-900 break-all">{address.data.address}</code>
                <Button variant="secondary" size="sm" onClick={() => void copy(address.data!.address!)}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy address'}
                </Button>
              </div>
              <p className="text-caption text-ink-500">
                Forward vendor bills here, or give it to vendors. Each attachment is read and waits for review.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-caption text-ink-500 hover:text-ink-900 hover:underline disabled:opacity-50"
                disabled={rotate.isPending}
                onClick={() => {
                  if (window.confirm('The current address stops working at once. Anyone forwarding to it will need the new one. Replace it?')) rotate.mutate();
                }}
              >
                <RefreshCw size={12} /> {rotate.isPending ? 'Replacing…' : 'Replace address'}
              </button>
              {rotate.isError && <p className="text-caption text-error-fg">{message(rotate.error)}</p>}
            </>
          )}
        </div>

        {/* WhatsApp */}
        <div className="space-y-2 bg-surface-card p-4">
          <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-ink-500">
            <MessageCircle size={13} /> Send bills on WhatsApp
          </p>
          {numbers.isError ? (
            <p className="text-caption text-error-fg">{message(numbers.error)}</p>
          ) : !numbers.data ? (
            <p className="text-caption text-ink-400">Loading…</p>
          ) : (
            <>
              {!numbers.data.configured && (
                <p className="text-caption text-ink-500">WhatsApp-in is not set up on this server yet. Numbers linked now start working once it is.</p>
              )}
              <p className="text-caption text-ink-500">Photos and PDFs sent from these numbers to the business WhatsApp are filed here.</p>
              {numbers.data.senders.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {numbers.data.senders.map((n) => (
                    <li key={n} className="inline-flex items-center gap-1 rounded-full border border-line-200 px-2 py-0.5 font-mono text-caption text-ink-900">
                      {formatPhone(n)}
                      <button
                        type="button"
                        aria-label={`Remove ${formatPhone(n)}`}
                        className="text-ink-400 hover:text-error-fg disabled:opacity-50"
                        disabled={unlink.isPending}
                        onClick={() => unlink.mutate(n)}
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {codeLive ? (
                <div className="rounded-md bg-pending-bg p-3 text-caption text-pending-fg">
                  From the phone you want to link, send{' '}
                  <span className="font-mono font-semibold">{pending!.text}</span> on WhatsApp to{' '}
                  {pending!.businessNumber ? <span className="font-mono font-semibold">{pending!.businessNumber}</span> : 'the business WhatsApp number'}. The code works once, for 15 minutes.
                  <span className="mt-1 flex items-center gap-1 text-ink-500">
                    <RefreshCw size={11} className="animate-spin" /> Waiting for the message…
                  </span>
                </div>
              ) : (
                <Button variant="secondary" size="sm" disabled={link.isPending} onClick={() => link.mutate()}>
                  {link.isPending ? 'Getting a code…' : 'Link a phone'}
                </Button>
              )}
              {pending && !codeLive && linkedCount > pending.before && <p className="text-caption text-success-fg">Phone linked.</p>}
              {(link.error ?? unlink.error) && <p className="text-caption text-error-fg">{message(link.error ?? unlink.error)}</p>}
              <p className="text-caption text-ink-400">A phone files to one business at a time. Linking it here moves it from any other.</p>
            </>
          )}
        </div>
      </div>

      {/* What arrived */}
      {rows.length > 0 && (
        <div className="border-t border-line-200 p-4">
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-500">Recently sent in</p>
          <ul className="divide-y divide-line-100">
            {shown.map((m) => (
              <li key={m._id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-caption">
                  {m.channel === 'email' ? <Mail size={13} className="text-ink-400" /> : <MessageCircle size={13} className="text-ink-400" />}
                  <span className="font-medium text-ink-900">{m.fromName ?? (m.from && m.channel === 'whatsapp' ? formatPhone(m.from) : m.from) ?? 'Unknown'}</span>
                  {m.fromName && m.from && <span className="font-mono text-ink-500">{m.channel === 'whatsapp' ? formatPhone(m.from) : m.from}</span>}
                  {!m.knownSender && (
                    <span
                      className="rounded-full border border-line-200 px-2 py-0.5 text-ink-600"
                      title="Not one of your vendors or team members. Check the bill is genuine before approving it."
                    >
                      Unknown sender
                    </span>
                  )}
                  {m.subject && <span className="truncate text-ink-500">· {m.subject}</span>}
                  <span className="ml-auto whitespace-nowrap text-ink-400">
                    {new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 pl-5">
                  {m.files.map((f, i) => (
                    <li key={`${f.fileName}-${i}`} className="flex flex-wrap items-center gap-2 text-caption">
                      <span className="font-mono text-ink-700">{f.fileName}</span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${FILE_STATUS[f.status].className}`}>{FILE_STATUS[f.status].label}</span>
                      {f.reason && <span className="text-ink-500">{f.reason}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {rows.length > 5 && (
            <button type="button" className="mt-2 text-caption text-ink-500 hover:text-ink-900 hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
