'use client';

import { Fragment, useRef } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, PageHeader, TableCard, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText, shortDate } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { cx, uploaderText, useStatements, useUploads, type StatementRow } from '@/components/documents/library';
import { Chip } from '@/components/documents/all-documents';
import { UploadList } from '@/components/documents/upload-parts';

const STAGE: Record<StatementRow['stage'], { label: string; tone: 'pending' | 'success' | 'error' }> = {
  reading: { label: 'Reading…', tone: 'pending' },
  imported: { label: 'Imported', tone: 'pending' },
  reconciled: { label: 'Reconciled', tone: 'success' },
  failed: { label: "Couldn't read", tone: 'error' },
};

const cell = 'px-3 py-2.5';

/** How far a statement's lines are matched: confirmed (green), matched and waiting to be confirmed (amber), unmatched (grey). */
function MatchBar({ row }: { row: StatementRow }) {
  const total = row.confirmed + row.matched + row.unmatched;
  if (!total) return <span className="text-caption text-ink-300">—</span>;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-sink" role="img" aria-label={`${row.confirmed} confirmed, ${row.matched} matched, ${row.unmatched} unmatched`}>
        <span className="bg-success-fg" style={{ width: pct(row.confirmed) }} />
        <span className="bg-marigold-400" style={{ width: pct(row.matched) }} />
      </div>
      <p className="mt-1 text-caption text-ink-600">
        <span className="font-mono tabular-nums text-ink-900">{row.confirmed + row.matched}</span> of <span className="font-mono tabular-nums">{total}</span> matched
        {row.unmatched > 0 && (
          <>
            {' · '}
            <span className="font-mono tabular-nums text-pending-fg">{row.unmatched}</span> <span className="text-pending-fg">unmatched</span>
          </>
        )}
      </p>
      {row.matched > 0 && <p className="text-[0.7rem] text-ink-400"><span className="font-mono tabular-nums">{row.matched}</span> to confirm</p>}
    </div>
  );
}

/**
 * Bank statements that came in, uploaded here, in Banking or the Files
 * inbox, or sent in by email. Each statement's lines go to Banking to be
 * matched with the books; nothing posts until a person confirms a match.
 */
export default function BankStatementsPage() {
  const qc = useQueryClient();
  const statements = useStatements();
  const uploads = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/retry`),
    onSuccess: () => notify('Sent for reading again'),
    onError: (e) => notify(errorText(e, "Couldn't read it again."), 'error'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['documents'] }),
  });
  const rows = statements.data ?? [];

  const openFile = async (documentId: string) => {
    try {
      const { url } = await api.get<{ url: string }>(`/documents/${documentId}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      notify(errorText(err, "Couldn't open the file."), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        guide="banking"
        title="Bank Statements"
        subtitle="Statements read from PDFs and spreadsheets. Their lines go to Banking to be matched with your entries; nothing posts until you confirm a match."
        actions={
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept=".pdf,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) uploads.add(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            <Button onClick={() => input.current?.click()}>
              <Upload size={16} /> Upload statement
            </Button>
          </>
        }
      />

      {uploads.items.length > 0 && (
        <div className="mb-4">
          <UploadList items={uploads.items} onClear={uploads.clearFinished} />
          <p className="mt-2 text-caption text-ink-500">A statement shows here once it has been read, usually within a minute.</p>
        </div>
      )}

      {statements.isError ? (
        <QueryError error={statements.error} onRetry={() => void statements.refetch()} />
      ) : statements.isLoading ? (
        <p className="flex items-center gap-2 py-10 text-caption text-ink-400">
          <Loader2 size={14} className="animate-spin" /> Loading statements…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No bank statements yet"
          body="Upload a statement as your bank gives it: PDF, CSV or Excel. AiBooks reads its lines, checks them against the balances, and sends them to Banking to match."
          action={<Button variant="secondary" onClick={() => input.current?.click()}><Upload size={16} /> Upload statement</Button>}
        />
      ) : (
        <TableCard>
          {/* Fixed widths, the statement taking the rest: beside the Documents panel there is no room to spare. */}
          <table className="w-full min-w-[780px] table-fixed">
            <colgroup>
              <col />
              <col className="w-[128px]" />
              <col className="w-[124px]" />
              <col className="w-[56px]" />
              <col className="w-[176px]" />
              <col className="w-[156px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Statement</th>
                <th className={th}>Bank account</th>
                <th className={th}>Period</th>
                <th className={cx(th, 'text-right')}>Lines</th>
                <th className={th}>Reconciliation</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STAGE[r.stage];
                const sheet = /\.(csv|xlsx?)$/i.test(r.fileName);
                return (
                  <Fragment key={r.key}>
                    <tr className="border-b border-line-100 align-top last:border-0 hover:bg-surface-sink">
                      <td className={cell}>
                        <div className="flex items-start gap-2">
                          {sheet ? <FileSpreadsheet size={15} className="mt-0.5 shrink-0 text-ink-400" /> : <FileText size={15} className="mt-0.5 shrink-0 text-ink-400" />}
                          <div className="min-w-0">
                            <button type="button" className="block max-w-full truncate text-left font-mono text-caption text-ink-900 hover:underline" onClick={() => void openFile(r.documentId)} title={`Open ${r.fileName}`}>
                              {r.fileName}
                            </button>
                            <span className="mt-1 inline-block">
                              <Chip tone={s.tone}>{s.label}</Chip>
                            </span>
                            <p className="mt-1 truncate text-caption text-ink-500" title={uploaderText(r.uploadedBy)}>
                              {shortDate(r.uploadedAt)} · {uploaderText(r.uploadedBy)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={cx(cell, 'text-caption')}>
                        {r.bankAccount ? (
                          <>
                            <span className="font-medium text-ink-900">{r.bankAccount.bankName ?? r.bankAccount.name}</span>
                            {r.bankAccount.last4 && <span className="ml-1 font-mono text-ink-500">··{r.bankAccount.last4}</span>}
                            {r.bankAccount.bankName && <span className="block text-ink-500">{r.bankAccount.name}</span>}
                          </>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className={cx(cell, 'whitespace-nowrap font-mono text-caption tabular-nums text-ink-700')}>
                        {r.periodStart && r.periodEnd ? (
                          <>
                            {r.periodStart}
                            <span className="block"><span className="font-sans text-ink-400">to </span>{r.periodEnd}</span>
                          </>
                        ) : (
                          <span className="font-sans text-ink-300">—</span>
                        )}
                      </td>
                      <td className={cx(cell, 'text-right font-mono text-caption tabular-nums text-ink-900')}>{r.linesImported}</td>
                      <td className={cell}>
                        <MatchBar row={r} />
                        {r.excluded > 0 && <p className="text-[0.7rem] text-ink-400"><span className="font-mono tabular-nums">{r.excluded}</span> set aside</p>}
                      </td>
                      <td className={cx(cell, 'text-right')}>
                        {r.bankAccount ? (
                          <Button variant="secondary" size="sm" asChild>
                            <Link href={`/banking?account=${r.bankAccount.id}`}>{r.stage === 'reconciled' ? 'Open reconciliation' : 'Run reconciliation'}</Link>
                          </Button>
                        ) : r.stage === 'failed' ? (
                          <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-saffron-700 hover:underline disabled:opacity-50" disabled={retry.isPending} onClick={() => retry.mutate(r.documentId)}>
                            <RefreshCw size={12} /> Try again
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {(r.failureReason || r.warnings.length > 0) && (
                      <tr className="border-b border-line-100">
                        <td colSpan={6} className={cx('px-3 pb-2.5 pt-0 text-caption', r.failureReason ? 'text-error-fg' : 'text-ink-500')}>
                          {r.failureReason ?? r.warnings.join(' ')}
                          {r.failureReason && ' Export the statement from your bank as Excel or CSV, or try a clearer PDF.'}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            <span className="font-mono tabular-nums">{rows.length}</span> {rows.length === 1 ? 'statement' : 'statements'}. Reconciliation opens the account&apos;s latest statement in Banking.
          </div>
        </TableCard>
      )}
    </div>
  );
}
