'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BankFeedsCard } from '@/components/banking/bank-feeds-card';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, AlertCircle, Minus, Sparkles, Copy, Undo2, EyeOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/query-error';

// ── Types ─────────────────────────────────────────────────────────────────

type MatchStatus = 'unmatched' | 'auto_matched' | 'manually_matched' | 'confirmed';

interface BankAccount {
  _id: string;
  name: string;
  accountNumber?: string;
  bankName?: string;
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

interface ReportLine {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  debitPaise: number;
  creditPaise: number;
  matchStatus: MatchStatus;
  matchedJournalId: string | null;
  matchedInvoiceId: string | null;
  matchedBillId: string | null;
  matchLabel: string | null;
  possibleDuplicate: boolean;
  excluded: boolean;
  /** Sent to be categorised: a proposal for it waits in the review queue. */
  inReview: boolean;
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
  unmatchedAmountPaise: number;
  pendingSettlements: number;
  possibleDuplicates: number;
  excludedLines: number;
  isReconciled: boolean;
  lines: ReportLine[];
}

interface ApiJournal {
  _id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  totalDebitPaise: number;
}

/** An open invoice or bill a bank line could settle. */
interface OpenDocument {
  _id: string;
  invoiceNumber?: string | null;
  billNumber?: string | null;
  customerName?: string;
  vendorName?: string;
  totalPaise: number;
  /** What is still owed — a bank line can settle part of it. */
  outstandingPaise: number;
}

interface ConfirmResult {
  confirmed: number;
  failed: Array<{ lineId: string; reason: string }>;
}

// ── Formatters ────────────────────────────────────────────────────────────

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(paise / 100);
}

function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

// ── Status chip ───────────────────────────────────────────────────────────

/** Amber = suggested, waiting for a person. Green = confirmed and in the ledger. */
function LineChip({ line }: { line: ReportLine }) {
  if (line.excluded) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-sink px-2 py-0.5 text-caption font-medium text-ink-500 border border-line-200">
        <EyeOff size={10} /> Set aside
      </span>
    );
  }
  if (line.matchStatus === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
        <CheckCircle size={10} /> In the books
      </span>
    );
  }
  if (line.matchStatus === 'auto_matched' || line.matchStatus === 'manually_matched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
        <Sparkles size={10} /> {line.matchStatus === 'auto_matched' ? 'Suggested' : 'Matched'} — confirm to post
      </span>
    );
  }
  if (line.inReview) {
    return (
      <Link
        href="/review"
        className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30 hover:underline"
      >
        <Sparkles size={10} /> In the review queue
      </Link>
    );
  }
  if (line.possibleDuplicate) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
        <Copy size={10} /> Possible duplicate
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-caption font-medium text-error-fg border border-error-fg/30">
      <AlertCircle size={10} /> Not in the books
    </span>
  );
}

const linkButton =
  'text-caption font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline disabled:opacity-50';

// ── Page ─────────────────────────────────────────────────────────────────

export default function BankingPage() {
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const showToast = (message: string, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), error ? 6000 : 3500);
  };

  const accountsQuery = useQuery<BankAccount[]>({
    queryKey: ['banking', 'accounts'],
    queryFn: () => api.get<BankAccount[]>('/banking/accounts'),
  });
  const accounts = accountsQuery.data ?? [];
  const effectiveAccountId = selectedAccountId ?? accounts[0]?._id ?? null;

  // Statements for the selected account, newest first.
  const statementsQuery = useQuery<ApiStatement[]>({
    queryKey: ['banking', 'statements', effectiveAccountId],
    queryFn: () => api.get<ApiStatement[]>(`/banking/statements?bankAccountId=${effectiveAccountId}`),
    enabled: !!effectiveAccountId,
  });
  const latestStatement = statementsQuery.data?.[0] ?? null;

  // The reconciliation report carries the bank lines, what each is matched to,
  // and the balances — computed once, on the server.
  const reportQuery = useQuery<DiffReport>({
    queryKey: ['banking', 'report', latestStatement?._id],
    queryFn: () => api.get<DiffReport>(`/banking/statements/${latestStatement!._id}/report`),
    enabled: !!latestStatement,
  });
  const report = reportQuery.data;
  const lines = report?.lines ?? [];

  // Receipts and payments in the period — the vouchers that move the bank. One
  // with no bank line yet is money the bank has not shown (e.g. an uncleared cheque).
  const journalsQuery = useQuery<{ data: ApiJournal[] }>({
    queryKey: ['journals', 'bank-vouchers', latestStatement?.periodStart, latestStatement?.periodEnd],
    queryFn: () =>
      api.get<{ data: ApiJournal[] }>(`/journals?from=${latestStatement!.periodStart}&to=${latestStatement!.periodEnd}`),
    enabled: !!latestStatement,
  });
  const matchedJournalIds = new Set(lines.map((l) => l.matchedJournalId).filter(Boolean));
  const unclearedVouchers = (journalsQuery.data?.data ?? []).filter(
    (j) => (j.voucherType === 'receipt' || j.voucherType === 'payment') && !matchedJournalIds.has(j._id),
  );

  // Open invoices and bills, for matching a line by hand.
  const openInvoicesQuery = useQuery<OpenDocument[]>({
    queryKey: ['sales', 'invoices', 'posted'],
    queryFn: () => api.get<OpenDocument[]>('/sales/invoices?status=posted'),
    enabled: !!latestStatement,
    retry: false,
  });
  const openBillsQuery = useQuery<OpenDocument[]>({
    queryKey: ['purchase', 'bills', 'posted'],
    queryFn: () => api.get<OpenDocument[]>('/purchase/bills?status=posted'),
    enabled: !!latestStatement,
    retry: false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['banking'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['sales'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase'] });
  };

  // ── Actions ────────────────────────────────────────────────────────────

  const autoMatchMutation = useMutation({
    mutationFn: (statementId: string) =>
      api.post<{ matched: number; unmatched: number }>(`/banking/statements/${statementId}/auto-match`),
    onSuccess: (res) => {
      showToast(
        res.matched > 0
          ? `Suggested ${res.matched} ${res.matched === 1 ? 'match' : 'matches'} — check and confirm`
          : 'No new matches found',
      );
      refresh();
    },
    onError: (err) => showToast(failureMessage(err, "Couldn't run reconciliation"), true),
  });

  const confirmMutation = useMutation({
    mutationFn: (statementId: string) => api.post<ConfirmResult>(`/banking/statements/${statementId}/confirm`),
    onSuccess: (res) => {
      if (res.failed.length > 0) {
        showToast(
          `Posted ${res.confirmed}; ${res.failed.length} could not be confirmed — ${res.failed[0].reason}`,
          true,
        );
      } else {
        showToast(`Posted to ledger — ${res.confirmed} ${res.confirmed === 1 ? 'line' : 'lines'} reconciled`);
      }
      refresh();
    },
    onError: (err) => showToast(failureMessage(err, "Couldn't confirm matches"), true),
  });

  const lineMutation = useMutation({
    mutationFn: ({ lineId, action, body }: { lineId: string; action: string; body?: unknown }) =>
      api.post(`/banking/lines/${lineId}/${action}`, body),
    onSuccess: () => refresh(),
    onError: (err) => showToast(failureMessage(err, "Couldn't update that line"), true),
  });
  const lineAction = (lineId: string, action: string, body?: unknown) => lineMutation.mutate({ lineId, action, body });

  // Lines with no invoice or bill behind them: the AI suggests an account for
  // each and the proposal waits in the review queue. Nothing posts until approved.
  const categoriseMutation = useMutation({
    mutationFn: (lineIds: string[]) =>
      api.post<{ queued: number; skipped: Array<{ lineId: string; reason: string }> }>('/banking/lines/categorise', { lineIds }),
    onSuccess: (res) => {
      showToast(
        res.queued
          ? `Sent ${res.queued} ${res.queued === 1 ? 'line' : 'lines'} to the review queue`
          : `Nothing sent: ${res.skipped[0]?.reason ?? 'no lines to categorise'}`,
        res.queued === 0,
      );
      // The proposals are written by a background job; look again shortly.
      setTimeout(() => refresh(), 3000);
    },
    onError: (err) => showToast(failureMessage(err, "Couldn't send those lines"), true),
  });

  /**
   * Uploading a statement goes through the ordinary document pipeline: the
   * spreadsheet ingest classifies a bank statement sheet and creates the
   * BankStatement and its lines, flagging possible duplicates as it does.
   */
  const uploadStatement = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    setUploading(true);
    try {
      await api.post('/documents/upload', body);
      showToast('Statement uploaded — reading it now');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['banking'] }), 4000);
    } catch (err) {
      showToast(failureMessage(err, "Couldn't upload that file"), true);
    } finally {
      setUploading(false);
    }
  };

  const uploadButton = (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-line-200 bg-surface-card px-4 py-2 text-body font-medium text-ink-900 transition-colors hover:bg-surface-sink">
      <Upload size={14} />
      {uploading ? 'Uploading…' : 'Upload statement'}
      <input
        type="file"
        accept=".pdf,.csv,.xlsx,.xls"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // so re-picking the same file still fires
          if (file) void uploadStatement(file);
        }}
      />
    </label>
  );

  const toastView = toast && (
    <div
      role="status"
      className={`fixed bottom-6 right-6 z-50 max-w-md rounded-md border px-4 py-3 text-body font-medium shadow-lg ${
        toast.error ? 'bg-error-bg border-error-fg text-error-fg' : 'bg-success-bg border-success-fg text-success-fg'
      }`}
    >
      {toast.message}
    </div>
  );

  // No bank account yet — prompt for a statement upload rather than an empty grid.
  if (accountsQuery.isSuccess && accounts.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Bank reconciliation</h1>
          <p className="text-body text-ink-500 mt-1">Match your bank statement to your books.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-sink flex items-center justify-center mb-6 border border-line-200">
            <Upload size={28} className="text-ink-400" />
          </div>
          <h2 className="text-h2 font-display text-ink-900 mb-2">Import a statement to reconcile.</h2>
          <p className="text-body text-ink-500 mb-6">Upload your bank statement and we&apos;ll match the lines.</p>
          {uploadButton}
          <p className="mt-3 text-caption text-ink-400">PDF, CSV or Excel, as your bank gives it.</p>
        </div>
        <BankFeedsCard onToast={showToast} />
        {toastView}
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a._id === effectiveAccountId);
  const accountLabel = selectedAccount
    ? `${selectedAccount.bankName ?? selectedAccount.name}${selectedAccount.accountNumber ? ' · ' + selectedAccount.accountNumber : ''}`
    : '';
  const toConfirm = lines.filter(
    (l) => !l.excluded && (l.matchStatus === 'auto_matched' || l.matchStatus === 'manually_matched'),
  ).length;
  const canMatch = lines.some((l) => !l.excluded && !l.possibleDuplicate && l.matchStatus === 'unmatched');
  const toCategorise = lines.filter((l) => !l.excluded && !l.possibleDuplicate && !l.inReview && l.matchStatus === 'unmatched');
  const busy = autoMatchMutation.isPending || confirmMutation.isPending || lineMutation.isPending || categoriseMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Bank reconciliation</h1>
          <p className="text-body text-ink-500 mt-1">
            {accountLabel}
            {latestStatement && ` · ${latestStatement.periodStart} to ${latestStatement.periodEnd}`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {latestStatement && canMatch && (
            <Button
              variant="secondary"
              onClick={() => autoMatchMutation.mutate(latestStatement._id)}
              disabled={busy}
              className="flex items-center gap-2"
            >
              <Sparkles size={14} className="text-marigold-400" />
              {autoMatchMutation.isPending ? 'Matching…' : 'Run reconciliation'}
            </Button>
          )}
          {latestStatement && toCategorise.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => categoriseMutation.mutate(toCategorise.map((l) => l.id))}
              disabled={busy}
              className="flex items-center gap-2"
              title="For lines with no invoice or bill: the AI suggests an account, and you approve each in the review queue"
            >
              <Sparkles size={14} className="text-marigold-400" />
              {categoriseMutation.isPending ? 'Sending…' : `Categorise ${toCategorise.length} unmatched`}
            </Button>
          )}
          {latestStatement && toConfirm > 0 && (
            <Button onClick={() => confirmMutation.mutate(latestStatement._id)} disabled={busy} className="flex items-center gap-2">
              <CheckCircle size={14} />
              {confirmMutation.isPending ? 'Posting…' : `Confirm ${toConfirm} ${toConfirm === 1 ? 'match' : 'matches'}`}
            </Button>
          )}
          {uploadButton}
        </div>
      </div>

      <BankFeedsCard onToast={showToast} />

      {accounts.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-caption text-ink-500">Account</span>
          <select
            className="rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
            value={effectiveAccountId ?? ''}
            onChange={(e) => setSelectedAccountId(e.target.value || null)}
          >
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.bankName ?? a.name}
                {a.accountNumber ? ` · ${a.accountNumber}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {reportQuery.isLoading && effectiveAccountId && (
        <div className="rounded-lg border border-line-200 bg-surface-card p-8 text-center text-caption text-ink-400">Loading…</div>
      )}
      {reportQuery.isError && (
        <div className="rounded-lg border border-line-200 bg-surface-card">
          <QueryError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
        </div>
      )}
      {statementsQuery.isSuccess && !latestStatement && (
        <div className="rounded-lg border border-dashed border-line-200 p-8 text-center text-body text-ink-500">
          No statement imported for this account yet.
        </div>
      )}

      {report && (
        <>
          {/* Summary band — every figure from the server's report */}
          <div className="rounded-lg border border-line-200 bg-surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                {report.isReconciled ? (
                  <p className="text-body font-semibold text-success-fg">Reconciled — the books agree with the bank.</p>
                ) : (
                  <p className="text-body font-semibold text-ink-900">
                    {report.unmatchedLines > 0
                      ? `${report.unmatchedLines} ${report.unmatchedLines === 1 ? 'line is' : 'lines are'} not in the books (${formatRupees(Math.abs(report.unmatchedAmountPaise))}).`
                      : 'Every line is matched.'}
                    {report.pendingSettlements > 0 && ` ${report.pendingSettlements} waiting for you to confirm.`}
                  </p>
                )}
                <p className="text-caption text-ink-500 mt-0.5">
                  {report.matchedLines} of {report.totalLines - report.excludedLines} lines matched
                  {report.possibleDuplicates > 0 && ` · ${report.possibleDuplicates} possible duplicate${report.possibleDuplicates === 1 ? '' : 's'}`}
                  {report.excludedLines > 0 && ` · ${report.excludedLines} set aside`}
                </p>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <p className="text-caption text-ink-500">Bank balance</p>
                  <p className="text-body font-mono font-semibold text-ink-900">{formatRupees(report.closingBalancePaise)}</p>
                </div>
                <div>
                  <p className="text-caption text-ink-500">In the books</p>
                  <p className="text-body font-mono font-semibold text-ink-900">{formatRupees(report.glBalancePaise)}</p>
                </div>
                <div>
                  <p className="text-caption text-ink-500">Difference</p>
                  <p className={`text-body font-mono font-semibold ${report.differencePaise === 0 ? 'text-success-fg' : 'text-error-fg'}`}>
                    {report.differencePaise === 0 ? '—' : (report.differencePaise > 0 ? '+' : '') + formatRupees(report.differencePaise)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Bank lines */}
            <div className="lg:col-span-2">
              <h2 className="text-body font-semibold text-ink-900 mb-3">Bank lines</h2>
              <div className="space-y-2">
                {lines.map((line) => {
                  const moneyIn = line.creditPaise > 0;
                  const amount = moneyIn ? line.creditPaise : line.debitPaise;
                  const settled = line.matchStatus === 'confirmed';
                  const suggested = line.matchStatus === 'auto_matched' || line.matchStatus === 'manually_matched';
                  // Anything still owing at least this much: a line can settle all or part of it.
                  // The exact amount comes first — that is most often the one.
                  const candidates = ((moneyIn ? openInvoicesQuery.data : openBillsQuery.data) ?? [])
                    .filter((d) => d.outstandingPaise >= amount)
                    .sort((a, b) => Number(b.outstandingPaise === amount) - Number(a.outstandingPaise === amount));

                  return (
                    <div
                      key={line.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        line.excluded
                          ? 'border-line-200 bg-surface-sink/50 opacity-70'
                          : settled
                            ? 'border-success-fg/30 bg-success-bg'
                            : suggested || line.possibleDuplicate
                              ? 'border-pending-fg/30 bg-pending-bg'
                              : 'border-line-200 bg-surface-card'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink-900 truncate">{line.description}</p>
                          <p className="text-caption text-ink-500 mt-0.5">
                            {new Date(line.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            {line.reference && <span className="ml-2 font-mono">{line.reference.slice(-8)}</span>}
                            {line.matchLabel && <span className="ml-2 font-mono text-ink-700">→ {line.matchLabel}</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-body font-mono font-medium ${moneyIn ? 'text-success-fg' : 'text-error-fg'}`}>
                            {moneyIn ? '+' : '−'}
                            {formatRupees(amount)}
                          </p>
                          <div className="mt-1">
                            <LineChip line={line} />
                          </div>
                        </div>
                      </div>

                      {!settled && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line-100 pt-2">
                          {line.excluded ? (
                            <button type="button" className={linkButton} disabled={busy} onClick={() => lineAction(line.id, 'exclude', { excluded: false })}>
                              Bring back
                            </button>
                          ) : line.inReview ? (
                            <Link href="/review" className={linkButton}>
                              Review the suggested entry
                            </Link>
                          ) : suggested ? (
                            <button type="button" className={`${linkButton} inline-flex items-center gap-1`} disabled={busy} onClick={() => lineAction(line.id, 'unmatch')}>
                              <Undo2 size={12} /> Not this one
                            </button>
                          ) : (
                            <>
                              {line.possibleDuplicate && (
                                <button type="button" className={linkButton} disabled={busy} onClick={() => lineAction(line.id, 'not-duplicate')}>
                                  Not a duplicate
                                </button>
                              )}
                              {candidates.length > 0 && (
                                <select
                                  aria-label={`Match ${line.description} to ${moneyIn ? 'an invoice' : 'a bill'}`}
                                  value=""
                                  disabled={busy}
                                  onChange={(e) =>
                                    e.target.value &&
                                    lineAction(line.id, 'match', moneyIn ? { invoiceId: e.target.value } : { billId: e.target.value })
                                  }
                                  className="rounded border border-line-200 bg-surface-card px-2 py-1 text-caption text-ink-900"
                                >
                                  <option value="">{moneyIn ? 'Settles invoice…' : 'Pays bill…'}</option>
                                  {candidates.map((d) => (
                                    <option key={d._id} value={d._id}>
                                      {(moneyIn ? d.invoiceNumber : d.billNumber) ?? 'No number'} · {(moneyIn ? d.customerName : d.vendorName) ?? ''}
                                      {d.outstandingPaise !== amount ? ` · ${formatRupees(d.outstandingPaise)} owed (part)` : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {!line.possibleDuplicate && (
                                <button
                                  type="button"
                                  className={`${linkButton} inline-flex items-center gap-1`}
                                  disabled={busy}
                                  onClick={() => categoriseMutation.mutate([line.id])}
                                >
                                  <Sparkles size={12} /> Categorise
                                </button>
                              )}
                              <button type="button" className={linkButton} disabled={busy} onClick={() => lineAction(line.id, 'exclude', { excluded: true })}>
                                Set aside
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* The books' side */}
            <div>
              <h2 className="text-body font-semibold text-ink-900 mb-3">In the books, not on the statement</h2>
              <div className="space-y-2">
                {unclearedVouchers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line-200 p-3">
                    <div className="flex items-center gap-2 text-ink-400">
                      <Minus size={14} />
                      <p className="text-caption">Every receipt and payment in this period is on the statement.</p>
                    </div>
                  </div>
                ) : (
                  unclearedVouchers.map((j) => (
                    <div key={j._id} className="rounded-lg border border-line-200 bg-surface-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink-900 truncate">{j.description || j.voucherNumber}</p>
                          <p className="text-caption text-ink-500 mt-0.5">
                            {new Date(j.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            <span className="ml-2 font-mono">{j.voucherNumber}</span>
                          </p>
                        </div>
                        <p className={`text-body font-mono font-medium shrink-0 ${j.voucherType === 'receipt' ? 'text-success-fg' : 'text-error-fg'}`}>
                          {j.voucherType === 'receipt' ? '+' : '−'}
                          {formatRupees(j.totalDebitPaise)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {toastView}
    </div>
  );
}
