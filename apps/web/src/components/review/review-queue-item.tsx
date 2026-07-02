'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ConfidenceField } from './confidence-field';
import { WarningsBanner } from './warnings-banner';
import { cn } from '@/lib/utils';
import { CheckCircle, X, Pencil, FileText } from 'lucide-react';

export interface ProposedEntryData {
  id: string;
  documentType: string;
  vendorName: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
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
}

interface ReviewQueueItemProps {
  entry: ProposedEntryData;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => void;
  onEdit: (id: string) => void;
}

type AnimationState = 'idle' | 'approving' | 'approved' | 'rejected';

export function ReviewQueueItem({ entry, onApprove, onReject, onEdit }: ReviewQueueItemProps) {
  const [animState, setAnimState] = useState<AnimationState>('idle');
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleApprove = async () => {
    setAnimState('approving');
    try {
      await onApprove(entry.id);
      setAnimState('approved');
    } catch {
      setAnimState('idle');
    }
  };

  const handleReject = () => {
    setAnimState('rejected');
    setTimeout(() => onReject(entry.id), 300);
  };

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
              {entry.documentType.replace(/_/g, ' ')}
              <br />
              <span className="text-ink-500 font-medium">{entry.vendorName ?? 'Unknown vendor'}</span>
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

        {/* Fields */}
        <div className="space-y-0">
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

        {/* Ledger suggestion microcopy */}
        <p className="text-caption text-ink-400 italic">
          I think this is a Purchase Expense — change it if I&apos;m wrong.
        </p>

        {/* Warnings */}
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
              onClick={() => onEdit(entry.id)}
              disabled={animState !== 'idle'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-body text-ink-700 border border-line-200 hover:bg-surface-sink transition-colors disabled:opacity-50 min-h-[40px]"
            >
              <Pencil size={14} />
              Edit
            </button>
            <Button
              variant="primary"
              onClick={handleApprove}
              disabled={animState !== 'idle'}
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
