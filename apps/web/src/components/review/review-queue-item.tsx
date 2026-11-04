'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ConfidenceField } from './confidence-field';
import { WarningsBanner } from './warnings-banner';
import { ChecksBanner } from './checks-banner';
import { JournalLinesEditor, JournalLineDraft, PostingAccount, linesStatus } from './journal-lines-editor';
import { cn } from '@/lib/utils';
import { CheckCircle, X, Pencil, FileText } from 'lucide-react';

export interface ProposedEntryData {
  id: string;
  documentType: string;
  vendorName: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** Printed due date, or one worked out from the payment terms. */
  dueDate: string | null;
  paymentTerms: string | null;
  confidenceOverall: number;
  fieldConfidence?: {
    vendor: number;
    invoiceNumber: number;
    invoiceDate: number;
    amounts: number;
  };
  rawWarnings: string[];
  amountsPaise: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total: number;
  };
  /** Presigned S3 URL for the source document */
  documentUrl?: string;
  /** The journal the AI proposes to post. */
  suggestedLines: JournalLineDraft[];
  /** What the bill checks found: a likely duplicate, a GSTIN not on file, GST likely blocked. */
  checks?: Array<{ code: string; severity: 'high' | 'medium'; message: string }>;
  /** Why the main account was chosen, when the categoriser chose it. */
  category?: {
    source: 'learned' | 'rule' | 'ai' | 'default';
    reason: string;
    accountName: string;
    confidence: number;
  } | null;
  /** Month-end entries: their own narration, and what made them and why. */
  narration?: string | null;
  adjustment?: { kind: string; period: string | null; reason: string; reverseOn?: string | null } | null;
}

const ADJUSTMENT_LABEL: Record<string, string> = {
  recurring_journal: 'Recurring journal',
  accrual: 'Accrual',
  prepaid: 'Prepaid expense',
  depreciation: 'Depreciation',
  capitalise: 'Capitalise an asset',
  disposal: 'Asset disposal',
  reclass: 'Reclassification',
};

const CATEGORY_SOURCE: Record<NonNullable<ProposedEntryData['category']>['source'], { label: string; className: string }> = {
  learned: { label: 'Your past choice', className: 'bg-success-bg text-success-fg' },
  rule: { label: 'From the HSN/SAC or wording', className: 'bg-honey-100 text-pending-fg' },
  ai: { label: 'AI suggestion', className: 'bg-honey-100 text-pending-fg' },
  default: { label: 'Nothing matched — check this', className: 'bg-surface-sink text-ink-700' },
};

interface ReviewQueueItemProps {
  entry: ProposedEntryData;
  /** Accounts a line can be moved to while editing. */
  accounts: PostingAccount[];
  /** `lines` is set only when the reviewer changed the AI's lines. */
  onApprove: (id: string, lines?: JournalLineDraft[]) => Promise<void>;
  onReject: (id: string) => void;
}

type AnimationState = 'idle' | 'approving' | 'approved' | 'rejected';

export function ReviewQueueItem({ entry, accounts, onApprove, onReject }: ReviewQueueItemProps) {
  const [animState, setAnimState] = useState<AnimationState>('idle');
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);
  const [lines, setLines] = useState<JournalLineDraft[]>(entry.suggestedLines);
  const cardRef = useRef<HTMLDivElement>(null);
  const { postable } = linesStatus(lines);

  const handleApprove = async () => {
    setAnimState('approving');
    try {
      // Untouched lines are left to the server, which posts its own suggestion.
      await onApprove(entry.id, edited ? lines : undefined);
      setAnimState('approved');
    } catch {
      setAnimState('idle');
    }
  };

  const handleReject = () => {
    setAnimState('rejected');
    setTimeout(() => onReject(entry.id), 300);
  };

  // The largest debit that is not a tax line is the ledger the AI chose.
  const mainLine = [...lines]
    .filter((l) => l.debitPaise > 0 && !/gst|cess/i.test(l.accountName))
    .sort((a, b) => b.debitPaise - a.debitPaise)[0];

  const gstTotal = entry.amountsPaise.cgst + entry.amountsPaise.sgst + entry.amountsPaise.igst + entry.amountsPaise.cess;
  const fc = entry.fieldConfidence ?? {
    vendor: entry.confidenceOverall,
    invoiceNumber: entry.confidenceOverall,
    invoiceDate: entry.confidenceOverall,
    amounts: entry.confidenceOverall,
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        'grid grid-cols-1 lg:grid-cols-2 rounded-lg border-2 overflow-hidden transition-all duration-200',
        animState === 'idle' && 'border-marigold-400 bg-surface-card',
        animState === 'approving' && 'border-marigold-400 bg-surface-card',
        animState === 'approved' && 'border-success-fg bg-success-bg animate-pulse',
        animState === 'rejected' && 'border-error-fg bg-error-bg opacity-50',
      )}
      style={{ '--tw-animate-duration': '0.2s' } as React.CSSProperties}
    >
      {/* ── Left: Document preview ─────────────────────────────────────── */}
      <div className="bg-surface-sink border-r border-line-200 flex flex-col items-center justify-center min-h-[320px] p-4">
        {entry.documentUrl ? (
          <iframe
            src={entry.documentUrl}
            className="w-full flex-1 rounded border border-line-200 min-h-[280px]"
            title="Source document"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-ink-400">
            <FileText size={40} strokeWidth={1} />
            <p className="text-caption text-center">
              {entry.adjustment ? `Month-end · ${ADJUSTMENT_LABEL[entry.adjustment.kind] ?? entry.adjustment.kind}` : entry.documentType.replace(/_/g, ' ')}
              <br />
              <span className="text-ink-500 font-medium">{entry.adjustment ? entry.adjustment.period ?? '' : entry.vendorName ?? 'Unknown vendor'}</span>
            </p>
          </div>
        )}
        {highlightedField && (
          <p className="mt-2 text-caption text-pending-fg text-center">
            Showing region for: <span className="font-medium">{highlightedField}</span>
          </p>
        )}
      </div>

      {/* ── Right: Extracted fields + actions ─────────────────────────── */}
      <div className="flex flex-col gap-4 p-5">
        {/* Status badge */}
        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-500 uppercase tracking-[0.04em]">
            {entry.documentType.replace(/_/g, ' ')}
          </span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-caption font-medium',
              entry.confidenceOverall >= 0.9 ? 'bg-success-bg text-success-fg' : 'bg-honey-100 text-pending-fg',
            )}
          >
            {Math.round(entry.confidenceOverall * 100)}% confidence
          </span>
        </div>

        {entry.adjustment && (
          <div className="space-y-2">
            <p className="text-body font-medium text-ink-900">{entry.narration}</p>
            <p className="text-caption text-ink-500">
              {ADJUSTMENT_LABEL[entry.adjustment.kind] ?? entry.adjustment.kind} · dated {entry.invoiceDate}
              {entry.adjustment.reverseOn ? ` · reverses itself on ${entry.adjustment.reverseOn}` : ''}
            </p>
            <p className={cn('rounded-md p-2 text-caption', entry.confidenceOverall < 1 ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-600')}>
              {entry.confidenceOverall < 1 ? 'Suggested by the month-end assistant: ' : ''}
              {entry.adjustment.reason}
            </p>
          </div>
        )}

        {/* Fields */}
        <div className={cn('space-y-0', entry.adjustment && 'hidden')}>
          <ConfidenceField
            label="Vendor"
            value={entry.vendorName}
            confidence={fc.vendor}
            onHighlight={() => setHighlightedField('Vendor')}
          />
          <ConfidenceField
            label="GSTIN"
            value={entry.vendorGstin}
            confidence={fc.vendor}
            onHighlight={() => setHighlightedField('GSTIN')}
          />
          <ConfidenceField
            label="Invoice #"
            value={entry.invoiceNumber}
            confidence={fc.invoiceNumber}
            onHighlight={() => setHighlightedField('Invoice number')}
          />
          <ConfidenceField
            label="Date"
            value={entry.invoiceDate}
            confidence={fc.invoiceDate}
            onHighlight={() => setHighlightedField('Date')}
          />
          {(entry.dueDate || entry.paymentTerms) && (
            <ConfidenceField
              label="Due"
              value={[entry.dueDate, entry.paymentTerms && `(${entry.paymentTerms})`].filter(Boolean).join(' ')}
              confidence={fc.invoiceDate}
              onHighlight={() => setHighlightedField('Due date')}
            />
          )}
          <ConfidenceField
            label="Taxable"
            value={String(entry.amountsPaise.taxableValue)}
            confidence={fc.amounts}
            isCurrency
            onHighlight={() => setHighlightedField('Taxable value')}
          />
          {gstTotal > 0 && (
            <ConfidenceField
              label="GST"
              value={String(gstTotal)}
              confidence={fc.amounts}
              isCurrency
              onHighlight={() => setHighlightedField('GST amount')}
            />
          )}
          <ConfidenceField
            label="Total"
            value={String(entry.amountsPaise.total)}
            confidence={fc.amounts}
            isCurrency
            onHighlight={() => setHighlightedField('Total amount')}
          />
        </div>

        {/* The journal that will post */}
        <div className="space-y-1.5">
          {!editing && entry.category ? (
            <div className="flex flex-wrap items-center gap-2 text-caption">
              <span className="text-ink-500">Filed under</span>
              <span className="font-medium text-ink-900">{entry.category.accountName}</span>
              <span className={cn('rounded-full px-2 py-0.5 font-medium', CATEGORY_SOURCE[entry.category.source].className)}>
                {CATEGORY_SOURCE[entry.category.source].label}
              </span>
              <span className="text-ink-500">{entry.category.reason}</span>
            </div>
          ) : (
            !editing &&
            mainLine && (
              <p className="text-caption text-ink-400 italic">
                I&apos;ve booked this to {mainLine.accountName} — change it if I&apos;m wrong.
              </p>
            )
          )}
          <JournalLinesEditor
            lines={lines}
            editing={editing}
            accounts={accounts}
            onChange={(next) => {
              setLines(next);
              setEdited(true);
            }}
          />
        </div>

        {/* Checks against the books, then extraction's own warnings */}
        <ChecksBanner checks={entry.checks ?? []} />
        <WarningsBanner warnings={entry.rawWarnings} />

        {/* Actions */}
        {animState === 'approved' ? (
          <div className="flex items-center gap-2 text-success-fg font-medium">
            <CheckCircle size={18} />
            Posted to ledger
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={animState !== 'idle'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-body text-ink-500 border border-line-200 hover:bg-surface-sink hover:border-ink-400 transition-colors disabled:opacity-50 min-h-[40px]"
            >
              <X size={14} />
              Reject
            </button>
            <button
              type="button"
              onClick={() => setEditing((on) => !on)}
              disabled={animState !== 'idle'}
              aria-pressed={editing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-body text-ink-700 border border-line-200 hover:bg-surface-sink transition-colors disabled:opacity-50 min-h-[40px]"
            >
              <Pencil size={14} />
              {editing ? 'Done editing' : 'Edit lines'}
            </button>
            <Button
              variant="primary"
              onClick={handleApprove}
              disabled={animState !== 'idle' || !postable}
              title={postable ? undefined : 'Every line needs an account, and debits must equal credits'}
              className="ml-auto"
            >
              {animState === 'approving' ? 'Posting…' : 'Approve & post'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
