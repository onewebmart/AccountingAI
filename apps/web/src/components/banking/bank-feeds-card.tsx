'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface FeedsView {
  provider: string;
  isMock: boolean;
  consents: Array<{
    _id: string;
    customerVua: string;
    status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
    fromDate: string;
    redirectUrl: string | null;
    lastSyncedAt: string | null;
    accounts: Array<{ maskedAccountNumber: string; fipName: string; syncedThrough: string | null; lastError: string | null }>;
  }>;
}

const STATUS: Record<FeedsView['consents'][number]['status'], { label: string; className: string }> = {
  PENDING: { label: 'Waiting for approval', className: 'bg-pending-bg text-pending-fg' },
  ACTIVE: { label: 'Connected', className: 'bg-success-bg text-success-fg' },
  REJECTED: { label: 'Declined', className: 'bg-error-bg text-error-fg' },
  REVOKED: { label: 'Disconnected', className: 'bg-surface-sink text-ink-500' },
  EXPIRED: { label: 'Expired', className: 'bg-surface-sink text-ink-500' },
};

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/**
 * Bank feeds through an Account Aggregator: transactions arrive by
 * themselves each morning instead of a statement being downloaded and
 * uploaded. Lines land in reconciliation as uploaded ones do.
 */
export function BankFeedsCard({ onToast }: { onToast: (text: string, error?: boolean) => void }) {
  const queryClient = useQueryClient();
  const [vua, setVua] = useState('');
  const [connecting, setConnecting] = useState(false);
  const feeds = useQuery<FeedsView>({ queryKey: ['bank-feeds'], queryFn: () => api.get<FeedsView>('/bank-feeds') });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-feeds'] });
    void queryClient.invalidateQueries({ queryKey: ['banking'] });
  };

  const connect = useMutation({
    mutationFn: () => api.post<{ redirectUrl: string }>('/bank-feeds/consents', { customerVua: vua.trim() }),
    onSuccess: (res) => {
      setConnecting(false);
      setVua('');
      refresh();
      onToast('Consent requested — approve it in your AA app');
      if (!feeds.data?.isMock) window.open(res.redirectUrl, '_blank', 'noopener');
    },
    onError: (err) => onToast(message(err, "Couldn't ask for consent"), true),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'sync' | 'refresh' | 'revoke' | 'mock-approve' }) =>
      api.post<{ accounts?: Array<{ imported: number; error: string | null }> }>(`/bank-feeds/consents/${id}/${action}`),
    onSuccess: (res, { action }) => {
      refresh();
      if (action === 'sync') {
        const imported = (res.accounts ?? []).reduce((s, a) => s + a.imported, 0);
        const failed = (res.accounts ?? []).find((a) => a.error);
        onToast(failed ? `Sync failed: ${failed.error}` : imported ? `Pulled ${imported} new bank lines` : 'Already up to date', !!failed);
      } else if (action === 'revoke') onToast('Bank disconnected');
      else if (action === 'mock-approve') onToast('Consent approved');
    },
    onError: (err) => onToast(message(err, "Couldn't reach the bank feed"), true),
  });

  const data = feeds.data;
  if (!data) return null;
  const live = data.consents.filter((c) => c.status !== 'REVOKED');

  return (
    <section className="rounded-lg border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-body font-semibold text-ink-900">
            <Link2 size={15} /> Bank feed
          </h2>
          <p className="text-caption text-ink-500">
            Connect through an Account Aggregator and transactions arrive each morning, ready to match.
          </p>
          {data.isMock && (
            <p className="mt-1 text-caption text-pending-fg">
              No Account Aggregator is connected yet, so this runs against a test bank with made-up transactions.
            </p>
          )}
        </div>
        {!connecting && (
          <Button variant="secondary" onClick={() => setConnecting(true)}>Connect a bank</Button>
        )}
      </div>

      {connecting && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Your AA handle</span>
            <input
              value={vua}
              onChange={(e) => setVua(e.target.value)}
              placeholder="9876543210@onemoney"
              className="w-64 rounded-md border border-line-200 bg-white px-3 py-2 text-body font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <Button type="submit" disabled={!vua.trim() || connect.isPending}>{connect.isPending ? 'Asking…' : 'Ask for consent'}</Button>
          <Button type="button" variant="secondary" onClick={() => setConnecting(false)}>Cancel</Button>
        </form>
      )}

      {live.length > 0 && (
        <ul className="mt-3 divide-y divide-line-100">
          {live.map((c) => (
            <li key={c._id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-body text-ink-900">
                  {c.accounts.length
                    ? c.accounts.map((a) => `${a.fipName} ${a.maskedAccountNumber}`).join(', ')
                    : c.customerVua}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-caption font-medium ${STATUS[c.status].className}`}>{STATUS[c.status].label}</span>
                </p>
                <p className="text-caption text-ink-500">
                  {c.accounts[0]?.syncedThrough ? `In up to ${c.accounts[0].syncedThrough}` : `From ${c.fromDate}`}
                  {c.accounts.find((a) => a.lastError) && <span className="text-error-fg"> · {c.accounts.find((a) => a.lastError)!.lastError}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {c.status === 'PENDING' && data.isMock && (
                  <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: c._id, action: 'mock-approve' })}>
                    Approve (test bank)
                  </Button>
                )}
                {c.status === 'PENDING' && !data.isMock && (
                  <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: c._id, action: 'refresh' })}>
                    Check approval
                  </Button>
                )}
                {c.status === 'ACTIVE' && (
                  <Button disabled={act.isPending} onClick={() => act.mutate({ id: c._id, action: 'sync' })} className="flex items-center gap-2">
                    <RefreshCw size={14} /> Sync now
                  </Button>
                )}
                <button
                  type="button"
                  className="text-caption font-medium text-ink-500 hover:text-error-fg"
                  disabled={act.isPending}
                  onClick={() => window.confirm('Disconnect this bank? Lines already pulled stay.') && act.mutate({ id: c._id, action: 'revoke' })}
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
