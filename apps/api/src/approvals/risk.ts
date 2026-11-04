/**
 * How risky a document is, from facts about it. Pure. A high score sends
 * it to a second approver; nothing here approves or refuses anything.
 */

export interface RiskFacts {
  /** YYYY-MM-DD */
  date: string;
  amountPaise: number;
  /** A vendor's first posted bill. */
  firstFromVendor?: boolean;
  /** Days since the vendor's bank account last changed, if it has. */
  bankChangedDaysAgo?: number | null;
  /** This vendor's usual bill, when there is history. */
  usualPaise?: number | null;
  /** Another bill from the vendor with the same number, or the same amount within a week. */
  possibleDuplicate?: string | null;
}

export interface Risk {
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

const rs = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

export function scoreRisk(f: RiskFacts): Risk {
  const reasons: string[] = [];
  let score = 0;
  if (f.possibleDuplicate) {
    score += 3;
    reasons.push(f.possibleDuplicate);
  }
  if (f.bankChangedDaysAgo != null && f.bankChangedDaysAgo <= 30) {
    score += 3;
    reasons.push(`The vendor's bank account changed ${f.bankChangedDaysAgo === 0 ? 'today' : `${f.bankChangedDaysAgo} day${f.bankChangedDaysAgo === 1 ? '' : 's'} ago`}.`);
  }
  if (f.firstFromVendor) {
    score += 2;
    reasons.push('The first bill from this vendor.');
  }
  if (f.usualPaise && f.usualPaise > 0 && f.amountPaise >= f.usualPaise * 3) {
    score += 2;
    reasons.push(`${rs(f.amountPaise)} is ${Math.round(f.amountPaise / f.usualPaise)}× this vendor's usual ${rs(f.usualPaise)}.`);
  }
  const day = new Date(`${f.date}T00:00:00Z`).getUTCDay();
  if (day === 0) {
    score += 1;
    reasons.push('Dated on a Sunday.');
  }
  return { score, level: score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low', reasons };
}
