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
function describe(error: unknown): { title: string; detail: string; retryable: boolean } {
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
  const { title, detail, retryable } = describe(error);

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
