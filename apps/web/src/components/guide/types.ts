import type { LucideIcon } from 'lucide-react';

/**
 * The shape of a section guide: a life-cycle chart, what you can do there,
 * and the clicks in order. Every piece of text comes in English and Hindi.
 */

export type GuideLang = 'en' | 'hi';

/** One piece of text in both languages. `**Bold**` marks a button name. */
export interface Bi {
  en: string;
  hi: string;
}

/**
 * What a box in the chart means, and so its colour:
 * - action: something you do (saffron)
 * - ai: the AI suggests it (amber, with an AI tag)
 * - wait: waiting for someone or something (amber)
 * - done: posted, paid, filed, finished (green)
 * - neutral: returned, cancelled, closed, put aside (grey; not an error)
 * - error: a real problem to fix (cool red)
 */
export type Tone = 'action' | 'ai' | 'wait' | 'done' | 'neutral' | 'error';

/** A box in the chart. */
export interface FlowStep {
  icon: LucideIcon;
  label: Bi;
  tone?: Tone;
  /** A small label on the connector that leads into this box. */
  edge?: Bi;
}

/** The flow splits: side by side, each with its own label on the connector. */
export interface FlowBranch {
  branch: Array<{ edge?: Bi; flow: Flow }>;
}

export type FlowRow = FlowStep | FlowBranch;
export type Flow = FlowRow[];

export interface Guide {
  /** The section's name, as in the sidebar. */
  section: Bi;
  /** Over the chart: "Life cycle of an invoice". */
  title: Bi;
  flow: Flow;
  /** "In this section you can:" — three to six short points. */
  can: Bi[];
  /** "Step by step" — what to click, with the button names on screen. */
  steps: Bi[];
  /** One line worth remembering, shown under the steps. */
  note?: Bi;
}

export function isBranch(row: FlowRow): row is FlowBranch {
  return 'branch' in row;
}

/** Shorthand for content files: text in both languages. */
export const t = (en: string, hi: string): Bi => ({ en, hi });
