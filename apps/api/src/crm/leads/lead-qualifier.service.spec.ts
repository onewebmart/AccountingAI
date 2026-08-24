/**
 * Lead qualifier parsing — the guards between a language model and a partner's
 * screen.
 *
 * The model is asked for JSON in a fixed shape, but "asked" is not "guaranteed".
 * Everything it returns is clamped or discarded rather than trusted, and the
 * one field that could matter commercially — recommended stage — can never come
 * back as WON or LOST.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { LeadSource, LeadStage } from '@ai-accounting/shared';
import { LeadQualifierService } from './lead-qualifier.service';

/** Drives the private parser through the public path with a stubbed model. */
function qualifierReturning(text: string): LeadQualifierService {
  const service = new LeadQualifierService({ get: () => undefined } as unknown as ConfigService);

  (service as unknown as { genAI: unknown }).genAI = {
    getGenerativeModel: () => ({
      generateContent: () =>
        Promise.resolve({
          response: {
            text: () => text,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
            candidates: [{ finishReason: 'STOP' }],
          },
        }),
    }),
  };

  return service;
}

const LEAD = {
  name: 'Ratan Steel Works',
  source: LeadSource.WEBSITE,
  services: [],
  enquiryNotes: 'Need GST filing.',
};

describe('LeadQualifierService parsing', () => {
  it('accepts a well-formed verdict', async () => {
    const service = qualifierReturning(
      JSON.stringify({
        score: 74,
        summary: 'Registered entity wanting recurring GST work.',
        signals: ['Has a GSTIN'],
        open_questions: ['Turnover?'],
        recommended_stage: 'PROPOSAL_SENT',
      }),
    );

    const result = await service.qualify(LEAD);
    expect(result.score).toBe(74);
    expect(result.recommendedStage).toBe(LeadStage.PROPOSAL_SENT);
    expect(result.signals).toEqual(['Has a GSTIN']);
    expect(result.openQuestions).toEqual(['Turnover?']);
  });

  it('clamps a score outside 0–100 instead of storing nonsense', async () => {
    const high = qualifierReturning(JSON.stringify({ score: 950, summary: 'x', recommended_stage: 'QUALIFYING' }));
    expect((await high.qualify(LEAD)).score).toBe(100);

    const low = qualifierReturning(JSON.stringify({ score: -20, summary: 'x', recommended_stage: 'QUALIFYING' }));
    expect((await low.qualify(LEAD)).score).toBe(0);
  });

  it('treats a non-numeric score as zero rather than NaN', async () => {
    const service = qualifierReturning(
      JSON.stringify({ score: 'very good', summary: 'x', recommended_stage: 'QUALIFYING' }),
    );
    expect((await service.qualify(LEAD)).score).toBe(0);
  });

  it('never lets the model recommend WON or LOST', async () => {
    // Winning or losing a client is a commercial fact a human owns. A model
    // asking for it is downgraded to the safe, reversible stage.
    for (const stage of ['WON', 'LOST', 'NEW', 'nonsense', '']) {
      const service = qualifierReturning(
        JSON.stringify({ score: 90, summary: 'x', recommended_stage: stage }),
      );
      expect((await service.qualify(LEAD)).recommendedStage).toBe(LeadStage.QUALIFYING);
    }
  });

  it('drops non-string entries from signals and open questions', async () => {
    const service = qualifierReturning(
      JSON.stringify({
        score: 50,
        summary: 'x',
        signals: ['real', 42, null, '', 'also real'],
        open_questions: 'not an array',
        recommended_stage: 'QUALIFYING',
      }),
    );

    const result = await service.qualify(LEAD);
    expect(result.signals).toEqual(['real', 'also real']);
    expect(result.openQuestions).toEqual([]);
  });

  it('substitutes a placeholder when no summary comes back', async () => {
    const service = qualifierReturning(JSON.stringify({ score: 50, recommended_stage: 'QUALIFYING' }));
    expect((await service.qualify(LEAD)).summary).toBe('No summary returned.');
  });

  it('fails loudly on non-JSON rather than storing garbage', async () => {
    const service = qualifierReturning('I think this lead looks quite promising!');
    await expect(service.qualify(LEAD)).rejects.toThrow(/invalid JSON/i);
  });
});
