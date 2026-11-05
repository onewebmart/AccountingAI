import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ProjectStatus = 'active' | 'on_hold' | 'completed';

/** A project as GET /projects lists it, with its figures from posted lines and time. */
export interface Project {
  id: string;
  name: string;
  code: string | null;
  status: ProjectStatus;
  billing: 'time' | 'fixed';
  customerId: string | null;
  customerName: string | null;
  budgetPaise: number | null;
  budgetHours: number | null;
  ratePaise: number | null;
  serviceItemId: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes: string | null;
  incomePaise: number;
  costPaise: number;
  profitPaise: number;
  hours: number;
  unbilledHours: number;
  unbilledPaise: number;
  alerts: Array<{ level: 'warn' | 'over'; text: string }>;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  task: string;
  notes: string | null;
  billable: boolean;
  ratePaise: number | null;
  status: 'unbilled' | 'billing' | 'billed';
  invoiceId: string | null;
}

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: 'success' | 'neutral' | 'pending' }> = {
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'neutral' },
};

/** Every project with its figures. The same query key as the project picker, so both refresh together. */
export function useProjectList() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
}

/** "2.5" hours → "2.5 h"; whole numbers without decimals. */
export const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} h`;
