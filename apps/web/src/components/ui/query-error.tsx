'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from './button';

/**
 * What went wrong, in words the reader can act on.
 *
 * Every page used to render the same "Couldn't load data. Try refreshing." for
 * any failure — a dead server, an expired session and a permission refusal all
 * looked identical, and refreshing only helped in one of the three cases.
 */
export function describeError(error: unknown): {
  title: string;
  detail: string;
  retryable: boolean;
} {
  if (error instanceof ApiError) {
    if (error.isOffline) {
      return {
        title: "Can't reach the server",
        detail: 'The API did not respond. Check that it is running, then try again.',
        retryable: true,
      };
    }
    if (error.status === 401) {
      return {
        title: 'Your session expired',
        detail: 'Sign in again to continue — you will come back to this page.',
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        title: 'You do not have access to this',
        detail: 'Your role does not include this permission. Ask an admin in your organisation.',
        retryable: false,
      };
    }
    if (error.status >= 500) {
      return {
        title: 'The server hit an error',
        detail: error.message,
        retryable: true,
      };
    }
    return { title: "Couldn't load this", detail: error.message, retryable: true };
  }

  return {
    title: "Couldn't load this",
    detail: error instanceof Error ? error.message : 'An unexpected error occurred.',
    retryable: true,
  };
}

export function QueryError({
  error,
  onRetry,
}: {
  error: unknown;
  /** Omit to hide the retry action — some failures are not worth retrying. */
  onRetry?: () => void;
}) {
  const { title, detail, retryable } = describeError(error);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-bg">
        <AlertCircle size={22} className="text-error-fg" />
      </div>
      <p className="text-body font-medium text-ink-900">{title}</p>
      <p className="mt-1 max-w-sm text-caption text-ink-500">{detail}</p>
      {onRetry && retryable ? (
        <Button variant="secondary" className="mt-5 gap-2" onClick={onRetry}>
          <RefreshCw size={15} />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The same explanation, sized for one row inside a table.
 *
 * A table cannot host the full-page block without breaking its own layout, and
 * the previous inline text ("Couldn't load data.") gave a reader nothing to act
 * on. Render inside a <tbody>.
 */
export function TableError({
  error,
  colSpan,
  onRetry,
}: {
  error: unknown;
  colSpan: number;
  onRetry?: () => void;
}) {
  const { title, detail, retryable } = describeError(error);

  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="flex items-center gap-1.5 text-body font-medium text-error-fg">
            <AlertCircle size={15} />
            {title}
          </span>
          <span className="max-w-sm text-caption text-ink-500">{detail}</span>
          {onRetry && retryable ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 text-caption font-medium text-saffron-600 hover:underline"
            >
              <RefreshCw size={13} />
              Try again
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
