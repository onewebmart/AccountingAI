'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AccountType } from '@ai-accounting/shared';
import type { Account } from './common';
import { formatPaise } from '@/lib/gst';

/** The five account types as the API stores them, in the order of a balance sheet then P&L. */
export const ACCOUNT_TYPES: Array<{ type: string; label: string }> = [
  { type: AccountType.ASSETS, label: 'Assets' },
  { type: AccountType.LIABILITIES, label: 'Liabilities' },
  { type: AccountType.CAPITAL, label: 'Capital' },
  { type: AccountType.INCOME, label: 'Income' },
  { type: AccountType.EXPENSE, label: 'Expenses' },
];

export const typeLabel = (type: string) => ACCOUNT_TYPES.find((t) => t.type === type)?.label ?? type;

/** Ids of an account and everything under it: a group cannot move under these. */
export function selfAndBelow(id: string, all: Account[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of all) {
      if (a.parentId && out.has(a.parentId) && !out.has(a._id)) {
        out.add(a._id);
        grew = true;
      }
    }
  }
  return out;
}

/** Groups an account of this type may sit under. */
export function groupsFor(type: string, all: Account[], exclude: Set<string> = new Set()) {
  return all.filter((a) => a.isGroup && a.type === type && a.isActive && !exclude.has(a._id));
}

/** One account and, beneath it, its children, however deep. */
export function AccountNode({ account, all, depth, selectedId, onSelect }: {
  account: Account;
  all: Account[];
  depth: number;
  selectedId: string | null;
  onSelect: (a: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = all.filter((a) => a.parentId === account._id);
  const selected = selectedId === account._id;
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect(account);
          if (children.length) setExpanded((v) => !v);
        }}
        className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${
          selected ? 'bg-honey-50 text-saffron-700' : 'text-ink-700 hover:bg-surface-sink hover:text-ink-900'
        } ${account.isActive ? '' : 'opacity-60'}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <span className="w-4 shrink-0 text-ink-400">
          {children.length ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="ml-0.5 block h-3.5 w-3.5 rounded-full border border-line-200" />}
        </span>
        <span className="shrink-0 font-mono text-caption text-ink-400">{account.code}</span>
        <span className={`flex-1 text-body ${account.isGroup ? 'font-semibold' : ''}`}>
          {account.name}
          {!account.isActive && <span className="ml-2 text-caption text-ink-500">Inactive</span>}
        </span>
        {!account.isGroup && account.balancePaise !== 0 && <span className="shrink-0 font-mono text-caption text-ink-400">{formatPaise(account.balancePaise)}</span>}
      </button>
      {children.length > 0 && expanded && (
        <div>
          {children.map((c) => (
            <AccountNode key={c._id} account={c} all={all} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
