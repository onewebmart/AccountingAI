import { AlertCircle, AlertTriangle } from 'lucide-react';

const TITLE: Record<string, string> = {
  duplicate_number: 'Likely a duplicate',
  duplicate_amount: 'Possibly a duplicate',
  gstin_differs: 'Not the GSTIN on file',
  new_vendor_large: 'New vendor, large bill',
  blocked_itc: 'GST likely not claimable',
};

/**
 * What the checks against the books found. Red when approving would likely
 * book something twice; amber when it needs a look. Neither stops approval:
 * the reviewer decides, but this proposal is never swept up by the bulk
 * approve.
 */
export function ChecksBanner({ checks }: { checks: Array<{ code: string; severity: 'high' | 'medium'; message: string }> }) {
  if (checks.length === 0) return null;
  const sorted = [...checks].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  return (
    <div className="space-y-2">
      {sorted.map((c, i) => {
        const high = c.severity === 'high';
        const Icon = high ? AlertCircle : AlertTriangle;
        return (
          <div
            key={i}
            role={high ? 'alert' : undefined}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 ${high ? 'border-error-fg/40 bg-error-bg' : 'border-marigold-400 bg-honey-100'}`}
          >
            <Icon size={14} className={`mt-0.5 shrink-0 ${high ? 'text-error-fg' : 'text-pending-fg'}`} aria-hidden="true" />
            <p className={`text-caption ${high ? 'text-error-fg' : 'text-pending-fg'}`}>
              <span className="font-semibold">{TITLE[c.code] ?? 'Check this'}.</span> {c.message}
            </p>
          </div>
        );
      })}
    </div>
  );
}
