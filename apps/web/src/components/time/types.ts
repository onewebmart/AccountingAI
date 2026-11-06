import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ProjectStatus = 'active' | 'on_hold' | 'completed';

/**
 * How a project is billed. fixed: an agreed fee, invoiced by hand.
 * project_hours: one rate for the project. task_hours: a rate per task.
 * staff_hours: a rate per person. (Projects from before read as project_hours.)
 */
export type BillingMethod = 'fixed' | 'project_hours' | 'task_hours' | 'staff_hours';

export const BILLING_METHODS: Array<{ value: BillingMethod; label: string; short: string }> = [
  { value: 'fixed', label: 'Fixed cost for project', short: 'Fixed fee' },
  { value: 'project_hours', label: 'Based on project hours', short: 'By project hours' },
  { value: 'task_hours', label: 'Based on task hours', short: 'By task hours' },
  { value: 'staff_hours', label: 'Based on staff hours', short: 'By staff hours' },
];
export const billingLabel = (m: BillingMethod | 'time') => BILLING_METHODS.find((b) => b.value === (m === 'time' ? 'project_hours' : m))?.short ?? 'By project hours';

export interface ProjectTask {
  id: string;
  name: string;
  description: string | null;
  billable: boolean;
  ratePaise: number | null;
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  ratePaise: number | null;
}

/** A project as GET /projects lists it, with its figures from posted lines and time. */
export interface Project {
  id: string;
  name: string;
  code: string | null;
  status: ProjectStatus;
  billing: BillingMethod;
  customerId: string | null;
  customerName: string | null;
  /** The single budget projects had before cost and revenue budgets: read it as the revenue budget. */
  budgetPaise: number | null;
  costBudgetPaise?: number | null;
  revenueBudgetPaise?: number | null;
  budgetHours: number | null;
  ratePaise: number | null;
  serviceItemId: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  notes: string | null;
  watchlist?: boolean;
  createdBy?: string;
  members?: ProjectMember[];
  tasks?: ProjectTask[];
  incomePaise: number;
  costPaise: number;
  profitPaise: number;
  hours: number;
  unbilledHours: number;
  unbilledPaise: number;
  alerts: Array<{ level: 'warn' | 'over'; text: string }>;
}

/** The revenue budget, or the old single budget standing in for it. */
export const revenueBudget = (p: Project) => p.revenueBudgetPaise ?? p.budgetPaise ?? null;

export interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  customerId?: string | null;
  customerName?: string | null;
  userId: string;
  userName: string;
  /** Who logged it: the person, or a manager for them. */
  loggedBy?: string;
  date: string;
  hours: number;
  startTime?: string | null;
  endTime?: string | null;
  taskId?: string | null;
  task: string;
  notes: string | null;
  billable: boolean;
  ratePaise: number | null;
  status: 'unbilled' | 'billing' | 'billed';
  invoiceId: string | null;
}

export interface TimeTotals {
  entries: number;
  hours: number;
  billableHours: number;
  unbilledHours: number;
  /** At each project's rates; null when the API did not say. */
  unbilledPaise: number | null;
}

export interface TimeList {
  entries: TimeEntry[];
  totals: TimeTotals;
  truncated: boolean;
}

/** GET /projects/time/entries; an API from before totals were added answered with the bare list. */
export async function fetchTime(query: string): Promise<TimeList> {
  const r = await api.get<TimeList | TimeEntry[]>(`/projects/time/entries${query ? `?${query}` : ''}`);
  if (!Array.isArray(r)) return r;
  const billable = r.filter((e) => e.billable);
  const unbilled = billable.filter((e) => e.status === 'unbilled');
  const sum = (xs: TimeEntry[]) => Math.round(xs.reduce((s, e) => s + e.hours, 0) * 100) / 100;
  return { entries: r, totals: { entries: r.length, hours: sum(r), billableHours: sum(billable), unbilledHours: sum(unbilled), unbilledPaise: null }, truncated: r.length >= 500 };
}

export interface Person {
  userId: string;
  name: string;
  email: string;
}

/** The org's people: a project's users, and whose time an entry is. */
export function usePeople() {
  return useQuery({ queryKey: ['projects', 'people'], queryFn: () => api.get<Person[]>('/projects/people'), retry: false, staleTime: 60_000 });
}

export interface RunningTimer {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  task: string;
  billable: boolean;
  notes: string | null;
  startedAt: string;
}

/** Your running timer, kept on the server; null when none is running. */
export function useTimer() {
  return useQuery({ queryKey: ['projects', 'timer'], queryFn: () => api.get<RunningTimer | null>('/projects/time/timer'), retry: false, refetchOnWindowFocus: true });
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

/** 1.5 hours → "1:30". */
export const hhmm = (h: number) => {
  const minutes = Math.round(h * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

/** Today in India, as the server counts it. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
