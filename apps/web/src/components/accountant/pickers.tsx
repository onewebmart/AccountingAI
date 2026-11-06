'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { api } from '@/lib/api';
import { isPartyAccount, useAccounts, type Account } from './common';
import { accountTypeLabel } from './account-types';
import { typeLabel } from './account-tree';

/**
 * An account to post a line to, searched by name, code or type. Groups and
 * deactivated accounts are left out, and so are the accounts kept party by
 * party (receivables, payables, advances, claims): a journal cannot post to
 * them, the documents do.
 */
export function AccountPicker({ value, onChange, id, invalid, 'aria-label': ariaLabel }: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const { data } = useAccounts();
  const options = useMemo<SearchOption[]>(() => {
    const order = ['ASSETS', 'LIABILITIES', 'CAPITAL', 'INCOME', 'EXPENSE'];
    return (data ?? [])
      .filter((a: Account) => !a.isGroup && (a.isActive || a._id === value) && !isPartyAccount(a))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.code.localeCompare(b.code))
      .map((a) => ({ value: a._id, label: a.name, detail: a.code, group: typeLabel(a.type), keywords: accountTypeLabel(a.accountType) }));
  }, [data, value]);
  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Choose an account"
      searchPlaceholder="Name, code or type"
      invalid={invalid}
      aria-label={ariaLabel}
    />
  );
}

interface Party { _id: string; name: string }

/** Customers and vendors, for a line's Contact. */
export function useContactOptions(): SearchOption[] {
  const customers = useQuery({ queryKey: ['sales', 'customers'], queryFn: () => api.get<Party[]>('/sales/customers') });
  const vendors = useQuery({ queryKey: ['purchase', 'vendors'], queryFn: () => api.get<Party[]>('/purchase/vendors') });
  return useMemo(
    () => [
      ...(customers.data ?? []).map((c) => ({ value: `customer:${c._id}`, label: c.name, group: 'Customers' })),
      ...(vendors.data ?? []).map((v) => ({ value: `vendor:${v._id}`, label: v.name, group: 'Vendors' })),
    ],
    [customers.data, vendors.data],
  );
}

/** A customer or vendor the line is about; "customer:<id>" or "vendor:<id>", or empty. */
export function ContactPicker({ value, onChange, options, id, 'aria-label': ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      noneLabel="No contact"
      placeholder="No contact"
      searchPlaceholder="Customer or vendor"
      aria-label={ariaLabel}
    />
  );
}
