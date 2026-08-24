import { EscalationReason } from '@ai-accounting/shared';

/**
 * Deterministic escalation triggers, checked BEFORE the model is called.
 *
 * The model is also asked whether it needs a human, and that signal is honoured
 * — but it is a second line of defence, not the first. A safety boundary that
 * depends only on a model's self-assessment is not a boundary: it fails exactly
 * when the model is most confused. These keyword rules cost nothing and cannot
 * be talked out of firing.
 *
 * Written for how Indian SME clients actually message a CA — Hinglish and
 * English mixed, often transliterated.
 */

interface RuleSet {
  reason: EscalationReason;
  /** Lower-cased substrings. Matched against the raw inbound text. */
  patterns: string[];
}

const RULES: RuleSet[] = [
  {
    // Anything that commits the firm commercially. A model must never quote a
    // fee, offer a discount, or promise a refund on a firm's behalf.
    reason: EscalationReason.COMMERCIAL,
    patterns: [
      'fee', 'fees', 'fis', 'charge', 'charges', 'kitna lagega', 'kitne paise',
      'price', 'pricing', 'rate', 'quotation', 'quote', 'discount', 'concession',
      'refund', 'paise wapas', 'bill kyu', 'invoice kyu', 'payment terms',
      'advance kitna', 'sasta', 'mehnga', 'kam kar do', 'negotiate',
    ],
  },
  {
    // Anything adversarial or with legal weight. These need a person, always.
    reason: EscalationReason.SENSITIVE,
    patterns: [
      'notice', 'summon', 'penalty', 'penalti', 'prosecution', 'raid', 'survey',
      'scrutiny', 'appeal', 'tribunal', 'court', 'lawyer', 'advocate', 'legal',
      'complaint', 'shikayat', 'galat', 'mistake ho gayi', 'wrong filing',
      'naraz', 'refund nahi mila', 'fraud', 'cheat',
    ],
  },
  {
    // The client asked for a human. Honour it immediately and literally.
    reason: EscalationReason.CLIENT_REQUESTED,
    patterns: [
      'ca sahab', 'ca sir', 'sir se baat', 'sahab se baat', 'talk to ca',
      'speak to someone', 'human', 'call me', 'call karo', 'phone karo',
      'baat karni hai', 'baat karao', 'manager', 'partner se',
    ],
  },
];

export interface EscalationCheck {
  escalate: boolean;
  reason?: EscalationReason;
  /** The phrase that tripped it, so the CA sees why. */
  matched?: string;
}

/**
 * Checks an inbound message against the deterministic rules.
 *
 * Order matters: commercial and sensitive topics outrank a request for a human,
 * because they are the ones a wrong answer actually harms.
 */
export function checkEscalation(text: string): EscalationCheck {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      // Pad both sides so "rate" does not match "corporate" and "fee" does not
      // match "coffee" — these fire on whole words, not fragments.
      if (haystack.includes(` ${pattern} `)) {
        return { escalate: true, reason: rule.reason, matched: pattern };
      }
    }
  }

  return { escalate: false };
}

/** Below this, the model's own answer is not trusted and a human takes over. */
export const MIN_REPLY_CONFIDENCE = 0.6;
