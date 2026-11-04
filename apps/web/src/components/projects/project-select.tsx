'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ProjectOption {
  id: string;
  name: string;
  status: 'active' | 'on_hold' | 'completed';
  customerId: string | null;
  customerName: string | null;
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectOption[]>('/projects'), retry: false });
}

/** Pick the project a line's income or cost belongs to; none for most lines. */
export function ProjectSelect({ value, onChange, className, customerId }: { value: string; onChange: (id: string) => void; className?: string; customerId?: string | null }) {
  const { data } = useProjects();
  const open = (data ?? []).filter((p) => p.status !== 'completed' || p.id === value);
  // A customer's own projects first, when the document has a customer.
  const sorted = customerId ? [...open].sort((a, b) => Number(b.customerId === customerId) - Number(a.customerId === customerId)) : open;
  if (!data?.length) return null;
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No project</option>
      {sorted.map((p) => (
        <option key={p.id} value={p.id}>{p.name}{p.customerName ? ` · ${p.customerName}` : ''}</option>
      ))}
    </select>
  );
}
