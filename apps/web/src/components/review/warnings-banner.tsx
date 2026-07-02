import { AlertTriangle } from 'lucide-react';

interface WarningsBannerProps {
  warnings: string[];
}

export function WarningsBanner({ warnings }: WarningsBannerProps) {
  if (!warnings.length) return null;
  return (
    <div className="rounded-md border border-marigold-400 bg-honey-100 px-3 py-2 flex gap-2 items-start">
      <AlertTriangle size={14} className="text-pending-fg mt-0.5 shrink-0" aria-hidden="true" />
      <ul className="space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-caption text-pending-fg">
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}
