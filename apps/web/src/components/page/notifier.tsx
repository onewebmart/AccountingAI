'use client';

import { useEffect, useState } from 'react';

/**
 * Toasts that outlive a page change: saving a form takes you to the record,
 * and the "Invoice saved" toast still shows there. Call notify() from
 * anywhere; <Notifier /> in the app layout shows them.
 */

type Tone = 'success' | 'error' | 'info';
interface Note { id: number; message: string; tone: Tone }

let next = 1;
const listeners = new Set<(n: Note) => void>();

export function notify(message: string, tone: Tone = 'success') {
  const note = { id: next++, message, tone };
  listeners.forEach((l) => l(note));
}

export function Notifier() {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    const add = (n: Note) => {
      setNotes((all) => [...all, n]);
      setTimeout(() => setNotes((all) => all.filter((x) => x.id !== n.id)), n.tone === 'error' ? 6000 : 3000);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  if (!notes.length) return null;
  return (
    <div className="fixed bottom-20 right-6 z-[60] flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {notes.map((n) => (
        <div
          key={n.id}
          className={
            n.tone === 'error'
              ? 'rounded-lg border border-error-fg bg-error-bg px-4 py-3 text-body text-error-fg shadow-lg'
              : n.tone === 'info'
                ? 'rounded-lg border border-line-200 bg-surface-card px-4 py-3 text-body text-ink-900 shadow-lg'
                : 'rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg'
          }
        >
          {n.message}
        </div>
      ))}
    </div>
  );
}
