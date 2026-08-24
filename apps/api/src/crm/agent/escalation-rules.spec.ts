/**
 * Escalation rules — the safety boundary on letting a model speak for a CA firm.
 *
 * These run before the model is ever called, so they cannot be talked out of
 * firing. The cases below are written the way Indian SME clients actually
 * message: Hinglish, transliterated, punctuation optional.
 */
import 'reflect-metadata';
import { EscalationReason } from '@ai-accounting/shared';
import { checkEscalation } from './escalation-rules';

describe('commercial questions never reach the model', () => {
  const cases = [
    'Fees kitni hogi GSTR-3B ki?',
    'bhai kitna lagega ITR ka',
    'can you give some discount',
    'I want a refund',
    'aapka rate kya hai',
    'ye bill kyu bheja hai',
  ];

  it.each(cases)('escalates: %s', (text) => {
    const result = checkEscalation(text);
    expect(result.escalate).toBe(true);
    expect(result.reason).toBe(EscalationReason.COMMERCIAL);
  });
});

describe('sensitive matters never reach the model', () => {
  const cases = [
    'GST department se notice aaya hai',
    'penalty lag gayi hai kya karein',
    'mujhe lawyer se baat karni padegi',
    'aapse galat filing ho gayi',
    'I want to make a complaint',
  ];

  it.each(cases)('escalates: %s', (text) => {
    expect(checkEscalation(text).escalate).toBe(true);
  });
});

describe('an explicit request for a person is honoured', () => {
  it.each([
    'CA sahab se baat karni hai',
    'please call me',
    'can I speak to someone',
  ])('escalates: %s', (text) => {
    const result = checkEscalation(text);
    expect(result.escalate).toBe(true);
    expect(result.reason).toBe(EscalationReason.CLIENT_REQUESTED);
  });
});

describe('ordinary questions are answerable', () => {
  const cases = [
    'GSTR-3B kab tak bharna hai August ka?',
    'Bank statement kahan bhejun?',
    'Maine documents bhej diye hain, mile kya?',
    'ITR filing ka status kya hai',
    'Namaste, mera GSTIN update karna hai',
  ];

  it.each(cases)('does not escalate: %s', (text) => {
    expect(checkEscalation(text).escalate).toBe(false);
  });
});

describe('matching precision', () => {
  it('fires on whole words, not fragments', () => {
    // "coffee" contains "fee"; "corporate" contains "rate". Neither is a
    // commercial question, and escalating them would bury the CA in noise.
    expect(checkEscalation('Office me coffee machine ka bill hai').escalate).toBe(false);
    expect(checkEscalation('corporate structure ke baare mein').escalate).toBe(false);
  });

  it('is unaffected by punctuation and case', () => {
    expect(checkEscalation('FEES?!').escalate).toBe(true);
    expect(checkEscalation('kitna lagega...').escalate).toBe(true);
  });

  it('prefers commercial over a request for a human when both appear', () => {
    // A wrong answer on fees is the harmful one, so it should be the reason on
    // record even though the client also asked to talk to someone.
    const result = checkEscalation('fees kitni hai, CA sahab se baat karani hai');
    expect(result.reason).toBe(EscalationReason.COMMERCIAL);
  });

  it('reports the phrase that tripped it', () => {
    expect(checkEscalation('kya discount mil sakta hai').matched).toBe('discount');
  });

  it('handles an empty message without escalating', () => {
    expect(checkEscalation('').escalate).toBe(false);
  });
});
