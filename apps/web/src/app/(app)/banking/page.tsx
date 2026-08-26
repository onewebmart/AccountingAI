'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, AlertCircle, Minus } from 'lucide-react';
import { api } from '@/lib/api';
import { QueryError } from '@/components/ui/query-error';

// ── Types ─────────────────────────────────────────────────────────────────

type MatchStatus = 'unmatched' | 'auto_matched' | 'manually_matched' | 'confirmed';

interface BankAccount {
  _id: string;
  name: string;
  accountNumber?: string;
  bankName?: string;
}

interface BankLine {
  _id: string;
  date: string;
  description: string;
  reference: string | null;
  debitPaise: number;
  creditPaise: number;
  matchStatus: MatchStatus;
  matchedBookEntry: string | null;
}

interface BookEntry {
  _id: string;
  date: string;
  narration: string;
  voucherType: string;
  amountPaise: number;
  side: 'debit' | 'credit';
  matchedBankLineId: string | null;
}

/** Shapes returned by the reconciliation API. */
interface ApiStatement {
  _id: string;
  periodStart: string;
  periodEnd: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  totalLines: number;
  matchedLines: number;
  status: string;
}

interface DiffReport {
  statementId: string;
  periodStart: string;
  periodEnd: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  glBalancePaise: number;
  differencePaise: number;
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  isReconciled: boolean;
  lines: Array<{
    id: string;
    date: string;
    description: string;
    reference: string | null;
    debitPaise: number;
    creditPaise: number;
    matchStatus: MatchStatus;
    matchedJournalId: string | null;
  }>;
}

interface ApiJournal {
  _id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
}

// ── Formatters ────────────────────────────────────────────────────────────

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(paise / 100);
}

// ── Match status chip ─────────────────────────────────────────────────────

function MatchChip({ status }: { status: MatchStatus }) {
  if (status === 'confirmed' || status === 'manually_matched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
        <CheckCircle size={10} />
        Matched
      </span>
    );
  }
  if (status === 'auto_matched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
        <CheckCircle size={10} />
        Matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-caption font-medium text-error-fg border border-error-fg/30">
      <AlertCircle size={10} />
      Unmatched
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function BankingPage() {
  const [toast, setToast] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Track local confirm state for auto-matched lines (optimistic)
  const [localConfirmed, setLocalConfirmed] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch bank accounts
  const accountsQuery = useQuery<BankAccount[]>({
    queryKey: ['banking', 'accounts'],
    queryFn: () => api.get<BankAccount[]>('/banking/accounts'),
  });

  const accounts = accountsQuery.data ?? [];

  // Auto-select first account when accounts load
  const effectiveAccountId = selectedAccountId ?? accounts[0]?._id ?? null;

  // Statements for the selected account, newest first.
  const statementsQuery = useQuery<ApiStatement[]>({
    queryKey: ['banking', 'statements', effectiveAccountId],
    queryFn: () =>
      api.get<ApiStatement[]>(`/banking/statements?bankAccountId=${effectiveAccountId}`),
    enabled: !!effectiveAccountId,
  });

  const latestStatement = statementsQuery.data?.[0] ?? null;

  // The reconciliation report carries the imported bank lines and their match state.
  const reportQuery = useQuery<DiffReport>({
    queryKey: ['banking', 'report', latestStatement?._id],
    queryFn: () => api.get<DiffReport>(`/banking/statements/${latestStatement!._id}/report`),
    enabled: !!latestStatement,
  });

  // The book side of the reconciliation: vouchers posted in the statement period.
  const journalsQuery = useQuery<{ data: ApiJournal[] }>({
    queryKey: ['journals', latestStatement?.periodStart, latestStatement?.periodEnd],
    queryFn: () =>
      api.get<{ data: ApiJournal[] }>(
        `/journals?from=${latestStatement!.periodStart}&to=${latestStatement!.periodEnd}`,
      ),
    enabled: !!latestStatement,
  });

  const rawBankLines: BankLine[] = (reportQuery.data?.lines ?? []).map((l) => ({
    _id: l.id,
    date: l.date,
    description: l.description,
    reference: l.reference,
    debitPaise: l.debitPaise,
    creditPaise: l.creditPaise,
    matchStatus: l.matchStatus,
    matchedBookEntry: l.matchedJournalId,
  }));

  const matchedJournalIds = new Set(
    (reportQuery.data?.lines ?? []).map((l) => l.matchedJournalId).filter(Boolean),
  );

  const bookEntries: BookEntry[] = (journalsQuery.data?.data ?? []).map((j) => ({
    _id: j._id,
    date: j.date,
    narration: j.description || j.voucherNumber,
    voucherType: j.voucherType,
    amountPaise: j.totalDebitPaise,
    // A voucher that increases the bank balance is a receipt; everything else is a payment.
    side: j.voucherType === 'receipt' || j.voucherType === 'sales' ? 'debit' : 'credit',
    matchedBankLineId: matchedJournalIds.has(j._id) ? j._id : null,
  }));

  // Apply local confirmed state to bank lines
  const lines: BankLine[] = rawBankLines.map((l) =>
    localConfirmed.has(l._id) ? { ...l, matchStatus: 'confirmed' as MatchStatus } : l,
  );

  const openingBalance = reportQuery.data?.openingBalancePaise ?? 0;
  const bankClosing = reportQuery.data?.closingBalancePaise ?? 0;

  const matchedLines = lines.filter(
    (l) => l.matchStatus === 'confirmed' || l.matchStatus === 'auto_matched' || l.matchStatus === 'manually_matched',
  );
  const unmatchedLines = lines.filter((l) => l.matchStatus === 'unmatched');
  const autoMatchedLines = lines.filter((l) => l.matchStatus === 'auto_matched');

  const unmatchedAmount = unmatchedLines.reduce(
    (s, l) => s + l.creditPaise - l.debitPaise,
    0,
  );

  const matchedCredits = matchedLines.reduce((s, l) => s + l.creditPaise, 0);
  const matchedDebits = matchedLines.reduce((s, l) => s + l.debitPaise, 0);
  const glBalance = openingBalance + matchedCredits - matchedDebits;
  const difference = bankClosing - glBalance;

  /**
   * Confirms the auto-matched lines against the statement.
   *
   * This used to POST to /banking/reconciliation, which does not exist, and
   * then report success from onError anyway — so the screen said "matches
   * confirmed" while the ledger was untouched. Reconciliation that lies about
   * what it reconciled is worse than reconciliation that fails loudly.
   */
  const confirmMutation = useMutation({
    mutationFn: (statementId: string) =>
      api.post(`/banking/statements/${statementId}/confirm`),
    onSuccess: (_data, statementId) => {
      const newConfirmed = new Set(localConfirmed);
      autoMatchedLines.forEach((l) => newConfirmed.add(l._id));
      setLocalConfirmed(newConfirmed);
      showToast(`${autoMatchedLines.length} matches confirmed`);
      queryClient.invalidateQueries({ queryKey: ['banking', 'statements', effectiveAccountId] });
      queryClient.invalidateQueries({ queryKey: ['banking', 'report', statementId] });
    },
    onError: (err) => {
      showToast(
        err instanceof Error ? `Couldn't confirm — ${err.message}` : "Couldn't confirm matches",
      );
    },
  });

  const handleConfirmMatches = () => {
    // The server confirms every auto-match on the statement, so it needs the
    // statement — not a list of pairs the client assembled.
    if (!latestStatement?._id) {
      showToast('No statement to confirm yet');
      return;
    }
    confirmMutation.mutate(latestStatement._id);
  };

  /**
   * Uploading a statement goes through the ordinary document pipeline: the
   * spreadsheet ingest already classifies a bank statement sheet and creates
   * the BankStatement and its lines, so there is nothing bank-specific to
   * build here — and one upload path means one place for parsing to be right.
   */
  const uploadStatement = async (file: File) => {
    const body = new FormData();
    body.append('file', file);

    setUploading(true);
    try {
      await api.post('/documents/upload', body);
      showToast('Statement uploaded — reading it now');
      // The lines appear once the worker finishes, so re-check shortly.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['banking'] });
      }, 4000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't upload that file");
    } finally {
      setUploading(false);
    }
  };

  // No bank account yet — prompt for a statement upload rather than an empty grid.
  if (accountsQuery.isSuccess && accounts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
              Bank reconciliation
            </h1>
            <p className="text-body text-ink-500 mt-1">Match your bank statement to your books.</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-sink flex items-center justify-center mb-6 border border-line-200">
            <Upload size={28} className="text-ink-400" />
          </div>
          <h2 className="text-h2 font-display text-ink-900 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Import a statement to reconcile.
          </h2>
          <p className="text-body text-ink-500 mb-6">Upload your bank statement and we&apos;ll match the lines.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm bg-saffron-600 px-4 py-2.5 text-body font-medium text-white transition-opacity hover:opacity-90">
            <Upload size={14} />
            {uploading ? 'Uploading…' : 'Upload statement'}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Clear the input so re-picking the same file still fires.
                e.target.value = '';
                if (file) void uploadStatement(file);
              }}
            />
          </label>
          <p className="mt-3 text-caption text-ink-400">CSV or Excel, as your bank exports it.</p>
        </div>
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success-bg border border-success-fg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
            {toast}
          </div>
        )}
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a._id === effectiveAccountId);
  const accountLabel = selectedAccount
    ? `${selectedAccount.bankName ?? selectedAccount.name}${selectedAccount.accountNumber ? ' · ' + selectedAccount.accountNumber : ''}`
    : 'HDFC Current Account · Mar 2025';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Bank reconciliation
          </h1>
          <p className="text-body text-ink-500 mt-1">
            {accountLabel}
          </p>
        </div>
        <div className="flex gap-2">
          {autoMatchedLines.length > 0 && (
            <Button onClick={handleConfirmMatches} disabled={confirmMutation.isPending} className="flex items-center gap-2">
              <CheckCircle size={14} />
              Confirm matches
            </Button>
          )}
          <Button variant="secondary" onClick={() => showToast('Upload new statement — coming soon')} className="flex items-center gap-2">
            <Upload size={14} />
            Upload statement
          </Button>
        </div>
      </div>

      {/* Bank account selector */}
      {(accountsQuery.isSuccess && accounts.length > 0) && (
        <div className="flex items-center gap-3">
          <span className="text-caption text-ink-500">Account</span>
          <select
            className="rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
            value={effectiveAccountId ?? ''}
            onChange={(e) => {
              setSelectedAccountId(e.target.value || null);
              setLocalConfirmed(new Set());
            }}
          >
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.bankName ?? a.name}{a.accountNumber ? ` · ${a.accountNumber}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Loading / error state for statement */}
      {reportQuery.isLoading && effectiveAccountId && (
        <div className="rounded-lg border border-line-200 bg-surface-card p-8 text-center text-caption text-ink-400">
          Loading…
        </div>
      )}

      {reportQuery.isError && (
        <div className="rounded-lg border border-line-200 bg-surface-card">
          <QueryError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
        </div>
      )}

      {/* Main reconciliation UI */}
      {(!reportQuery.isLoading || !effectiveAccountId) && !reportQuery.isError && (
        <>
          {/* Summary band */}
          <div className="rounded-lg border border-line-200 bg-surface-card p-4">
            <div className="flex items-center justify-between">
              <div>
                {unmatchedLines.length > 0 ? (
                  <p className="text-body font-semibold text-ink-900">
                    {formatRupees(Math.abs(unmatchedAmount))} unmatched across {unmatchedLines.length} {unmatchedLines.length === 1 ? 'line' : 'lines'}.
                  </p>
                ) : (
                  <p className="text-body font-semibold text-success-fg">All lines reconciled.</p>
                )}
                <p className="text-caption text-ink-500 mt-0.5">
                  I matched {matchedLines.length} of {lines.length} lines.{' '}
                  {unmatchedLines.length > 0 ? `${unmatchedLines.length} need you.` : ''}
                </p>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <p className="text-caption text-ink-500">Bank balance</p>
                  <p className="text-body font-mono font-semibold text-ink-900">{formatRupees(bankClosing)}</p>
                </div>
                <div>
                  <p className="text-caption text-ink-500">GL balance</p>
                  <p className="text-body font-mono font-semibold text-ink-900">{formatRupees(glBalance)}</p>
                </div>
                <div>
                  <p className="text-caption text-ink-500">Difference</p>
                  <p className={`text-body font-mono font-semibold ${difference === 0 ? 'text-success-fg' : 'text-error-fg'}`}>
                    {difference === 0 ? '—' : (difference > 0 ? '+' : '') + formatRupees(difference)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Two-column reconciliation view */}
          <div className="grid grid-cols-2 gap-4">
            {/* Bank lines column */}
            <div>
              <h2 className="text-body font-semibold text-ink-900 mb-3">Bank lines</h2>
              <div className="space-y-2">
                {lines.map((line) => {
                  const isMatched =
                    line.matchStatus === 'confirmed' ||
                    line.matchStatus === 'auto_matched' ||
                    line.matchStatus === 'manually_matched';

                  return (
                    <div
                      key={line._id}
                      className={`rounded-lg border p-3 transition-colors ${
                        isMatched
                          ? line.matchStatus === 'confirmed'
                            ? 'border-success-fg/30 bg-success-bg'
                            : 'border-pending-fg/30 bg-pending-bg'
                          : 'border-line-200 bg-surface-card'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink-900 truncate">{line.description}</p>
                          <p className="text-caption text-ink-500 mt-0.5">
                            {new Date(line.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            {line.reference && (
                              <span className="ml-2 font-mono">{line.reference.slice(-8)}</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {line.debitPaise > 0 ? (
                            <p className="text-body font-mono font-medium text-error-fg">
                              −{formatRupees(line.debitPaise)}
                            </p>
                          ) : (
                            <p className="text-body font-mono font-medium text-success-fg">
                              +{formatRupees(line.creditPaise)}
                            </p>
                          )}
                          <div className="mt-1">
                            <MatchChip status={line.matchStatus} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Book entries column */}
            <div>
              <h2 className="text-body font-semibold text-ink-900 mb-3">Book entries</h2>
              <div className="space-y-2">
                {bookEntries.map((entry) => {
                  const matchedLine = lines.find((l) => l._id === entry.matchedBankLineId);
                  const isMatched = !!matchedLine && matchedLine.matchStatus !== 'unmatched';

                  return (
                    <div
                      key={entry._id}
                      className={`rounded-lg border p-3 transition-colors ${
                        isMatched
                          ? matchedLine?.matchStatus === 'confirmed'
                            ? 'border-success-fg/30 bg-success-bg'
                            : 'border-pending-fg/30 bg-pending-bg'
                          : 'border-line-200 bg-surface-card'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink-900 truncate">{entry.narration}</p>
                          <p className="text-caption text-ink-500 mt-0.5">
                            {new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            <span className="ml-2 uppercase">{entry.voucherType}</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-body font-mono font-medium ${entry.side === 'credit' ? 'text-error-fg' : 'text-success-fg'}`}>
                            {entry.side === 'credit' ? '−' : '+'}{formatRupees(entry.amountPaise)}
                          </p>
                          {isMatched && (
                            <div className="mt-1">
                              <MatchChip status={matchedLine!.matchStatus} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Unmatched bank lines with no book entry */}
                {unmatchedLines.length > 0 && (
                  <div className="rounded-lg border border-dashed border-line-200 p-3">
                    <div className="flex items-center gap-2 text-ink-400">
                      <Minus size={14} />
                      <p className="text-caption">{unmatchedLines.length} bank {unmatchedLines.length === 1 ? 'line' : 'lines'} with no book entry</p>
                    </div>
                    {unmatchedLines.map((l) => (
                      <div key={l._id} className="mt-2 pl-5">
                        <p className="text-caption text-ink-600">{l.description}</p>
                        <p className="text-caption font-mono text-ink-500">
                          {l.debitPaise > 0 ? `−${formatRupees(l.debitPaise)}` : `+${formatRupees(l.creditPaise)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success-bg border border-success-fg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
