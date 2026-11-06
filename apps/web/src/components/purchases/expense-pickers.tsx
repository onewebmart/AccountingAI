'use client';

import { SearchSelect, type SearchOption } from '@/components/page/search-select';
import { useCustomers } from '@/components/sales/sales-data';
import { useExpenseAccounts, usePaidThroughAccounts, useVendors } from './purchase-data';

/**
 * The pickers every expense form shares (a single expense, mileage, a
 * recurring expense), so each chooses an account, a bank, a vendor or a
 * customer the same way: a dropdown with a search box.
 */

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export function useExpenseAccountOptions(): { options: SearchOption[]; loading: boolean; empty: boolean } {
  const accounts = useExpenseAccounts();
  return {
    options: accounts.data.map((a) => ({ value: a._id, label: a.name, detail: a.code })),
    loading: accounts.isLoading,
    empty: !accounts.isLoading && accounts.data.length === 0,
  };
}

export function ExpenseAccountPicker(props: PickerProps) {
  const { options, loading } = useExpenseAccountOptions();
  return (
    <SearchSelect
      {...props}
      options={options}
      placeholder={loading ? 'Loading accounts…' : 'Select an account'}
      searchPlaceholder="Search expense accounts"
      aria-label={props['aria-label'] ?? 'Expense account'}
    />
  );
}

export function PaidThroughPicker(props: PickerProps) {
  const accounts = usePaidThroughAccounts();
  const options = (accounts.data ?? []).map((a) => ({ value: a._id, label: a.name, detail: a.code, group: a.kind === 'cash' ? 'Cash' : 'Bank' }));
  // Banks first, then cash, each under its heading.
  options.sort((a, b) => (a.group === b.group ? 0 : a.group === 'Bank' ? -1 : 1));
  return (
    <SearchSelect
      {...props}
      options={options}
      placeholder={accounts.isLoading ? 'Loading…' : 'Select a bank or cash account'}
      searchPlaceholder="Search bank and cash accounts"
      aria-label={props['aria-label'] ?? 'Paid through'}
    />
  );
}

export function VendorPicker(props: PickerProps) {
  const vendors = useVendors();
  const options = (vendors.data ?? []).map((v) => ({ value: v._id, label: v.name, detail: v.gstin ?? undefined }));
  return (
    <SearchSelect
      {...props}
      options={options}
      noneLabel="No vendor"
      placeholder={vendors.isLoading ? 'Loading…' : 'No vendor'}
      searchPlaceholder="Search vendors by name or GSTIN"
      aria-label={props['aria-label'] ?? 'Vendor'}
    />
  );
}

export function CustomerPicker(props: PickerProps) {
  const customers = useCustomers();
  const options = (customers.data ?? []).map((c) => ({ value: c._id, label: c.name, detail: c.gstin ?? undefined }));
  return (
    <SearchSelect
      {...props}
      options={options}
      noneLabel="No customer"
      placeholder={customers.isLoading ? 'Loading…' : 'No customer'}
      searchPlaceholder="Search customers by name or GSTIN"
      aria-label={props['aria-label'] ?? 'Customer'}
    />
  );
}

/** Billable: only once a customer is chosen, since it is billed on to them. */
export function BillableToggle({ checked, onChange, customerName }: { checked: boolean; onChange: (v: boolean) => void; customerName?: string | null }) {
  return (
    <label className="flex items-start gap-2 text-body text-ink-900">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-saffron-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Billable
        <span className="block text-caption text-ink-500">To bill on to {customerName ?? 'the customer'}. It waits under their billable expenses until invoiced.</span>
      </span>
    </label>
  );
}
