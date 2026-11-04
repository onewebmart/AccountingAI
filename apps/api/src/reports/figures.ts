/**
 * Numbers come from code; words come from the model. These check that every
 * figure in a sentence the model wrote is one the code computed: a sentence
 * with a figure of its own making is dropped, not shown.
 */

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twice: 2, double: 2, doubled: 2, half: 0.5, halved: 0.5, tripled: 3,
};

/** The numbers written in a piece of text: ₹1,25,000.50 → 125000.5, 18.2% → 18.2, "three" → 3. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (WORDS[w] !== undefined) out.push(WORDS[w]);
  return out;
}

/**
 * Whether each number in the text is among the known ones. Years and the
 * smallest counts pass, since "2026" or "two customers" names no amount;
 * percentages and amounts must match a figure to the paisa or a tenth.
 */
export function figuresKnown(text: string, known: number[]): boolean {
  const set = known.map((n) => Math.abs(n));
  return numbersIn(text).every((n) => (n >= 2000 && n <= 2100 && Number.isInteger(n)) || (n <= 12 && Number.isInteger(n)) || n === 0.5 || set.some((k) => Math.abs(k - n) < 0.051 || Math.abs(Math.round(k) - n) < 0.001));
}

/** Rupees as a person writes them in a sentence: ₹1,25,000 (paise kept only when there are some). */
export function inr(paise: number): string {
  const r = Math.abs(paise) / 100;
  const whole = Number.isInteger(r);
  return `${paise < 0 ? '-' : ''}₹${r.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/** A percentage for a sentence: whole above ten, one decimal below. */
export const pct = (v: number) => `${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.round(Math.abs(v) * 10) / 10}%`;
