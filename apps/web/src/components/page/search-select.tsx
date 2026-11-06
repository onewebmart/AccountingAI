'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchOption {
  value: string;
  label: string;
  /** A heading the option sits under, such as an account's group. Options of a group must be next to each other. */
  group?: string;
  /** Shown after the label, quieter: a code. */
  detail?: string;
  /** More words the search matches. */
  keywords?: string;
}

/**
 * A dropdown with a search box: for lists too long to scroll, such as
 * accounts, units or vendors. Grouped under headings when the options carry
 * one; the chosen option has a tick. Arrow keys move, Enter picks, Escape
 * closes.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Select',
  searchPlaceholder = 'Type to search',
  noneLabel,
  disabled,
  invalid,
  id,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** Offer an empty choice at the top, with this label (such as "No preferred vendor"). */
  noneLabel?: string;
  disabled?: boolean;
  /** Draws the field as needing attention. */
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return noneLabel ? [{ value: '', label: noneLabel }, ...options] : options;
    // Best matches first within each group: the label's start, then a word's or the code's start, then anywhere.
    const score = (o: SearchOption) => {
      const label = o.label.toLowerCase();
      if (label.startsWith(needle)) return 0;
      if (label.split(/[\s\-–/&(),.]+/).some((w) => w.startsWith(needle)) || o.detail?.toLowerCase().startsWith(needle)) return 1;
      return [o.label, o.detail, o.group, o.keywords].some((s) => s?.toLowerCase().includes(needle)) ? 2 : -1;
    };
    const groupAt = new Map<string, number>();
    for (const o of options) if (!groupAt.has(o.group ?? '')) groupAt.set(o.group ?? '', groupAt.size);
    return options
      .map((o, i) => ({ o, i, s: score(o) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => groupAt.get(a.o.group ?? '')! - groupAt.get(b.o.group ?? '')! || a.s - b.s || a.i - b.i)
      .map((x) => x.o);
  }, [options, query, noneLabel]);

  const openList = (seed = '') => {
    if (disabled) return;
    // Open upward when the list would run under the bottom of the screen (or a form's action bar) and there is more room above.
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const bar = document.querySelector('[data-form-bar]')?.getBoundingClientRect().height ?? 0;
      const below = window.innerHeight - bar - r.bottom;
      setUp(below < 320 && r.top > below);
    }
    setQuery(seed);
    setOpen(true);
  };
  const close = (focusTrigger: boolean) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) trigger.current?.focus();
  };
  const pick = (v: string) => {
    onChange(v);
    close(true);
  };

  // Start on the chosen option; after a search, on the first match.
  useEffect(() => {
    if (!open) return;
    const at = query ? 0 : shown.findIndex((o) => o.value === value);
    setActive(Math.max(at, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the list opens or the search changes
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      // Never submits the form the field is in.
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  let lastGroup: string | undefined;
  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openList();
          } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Typing on the closed field starts a search.
            e.preventDefault();
            openList(e.key);
          }
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-body focus:outline-none focus:ring-2 focus:ring-brand-600/40 disabled:cursor-not-allowed disabled:bg-surface-sink disabled:text-ink-500',
          invalid ? 'border-error-fg' : open ? 'border-brand-600' : 'border-line-200',
        )}
      >
        <span className={cn('min-w-0 truncate', selected ? 'text-ink-900' : 'text-ink-400')}>
          {selected ? selected.label : value === '' && noneLabel ? noneLabel : placeholder}
          {selected?.detail && <span className="ml-2 font-mono text-caption text-ink-400">{selected.detail}</span>}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={cn('absolute left-0 right-0 z-40 overflow-hidden rounded-md border border-line-200 bg-surface-card shadow-e2', up ? 'bottom-full mb-1' : 'top-full mt-1')}>
          <div className="relative border-b border-line-100 p-2">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="w-full rounded-sm border border-line-200 bg-white py-1.5 pl-8 pr-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          <ul ref={list} id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-3 text-caption text-ink-500">Nothing matches “{query.trim()}”.</li>}
            {shown.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSelected = o.value === value;
              return (
                <li key={`${o.group ?? ''}:${o.value}`} role="presentation">
                  {heading && (
                    <p className="px-3 pb-1 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500" role="presentation">{heading}</p>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    // mousedown, not click: the search box keeps focus until the pick lands.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o.value);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 py-2 pr-3 text-body',
                      o.group ? 'pl-5' : 'pl-3',
                      i === active ? 'bg-honey-100' : '',
                      isSelected ? 'font-medium text-ink-900' : o.value === '' ? 'text-ink-500' : 'text-ink-700',
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {o.label}
                      {o.detail && <span className="ml-2 font-mono text-caption text-ink-400">{o.detail}</span>}
                    </span>
                    {isSelected && <Check size={15} className="shrink-0 text-brand-700" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
