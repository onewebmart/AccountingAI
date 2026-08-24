'use client';

import { FadeIn } from '@/components/motion/primitives';
import { Button } from '@/components/ui/button';

/**
 * The shared empty state.
 *
 * An empty screen is the first thing a new firm sees, so it does the work of
 * onboarding: it says what would appear here, and offers the one action that
 * makes it appear. "No data" tells someone nothing they did not already know.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
}) {
  return (
    <FadeIn>
      <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-honey-100 text-saffron-700">
          {icon}
        </span>
        <p className="mt-4 font-heading text-lg font-semibold text-ink-900">{title}</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{body}</p>
        {action ? (
          <Button className="mt-6 gap-2" onClick={action.onClick}>
            {action.icon}
            {action.label}
          </Button>
        ) : null}
      </div>
    </FadeIn>
  );
}
