import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';
import { ClientContext, ClientContextService } from './client-context.service';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Output budget, which on a thinking model must also cover the thinking.
 *
 * Replies here are deliberately short, but `maxOutputTokens` does not bound the
 * reply — it bounds reasoning plus reply, and the reasoning is by far the larger
 * half. At 800 a slightly harder client question exhausts the budget on thinking
 * alone and returns a truncated answer (the same fault that broke lead
 * qualification at 1,024). Reply length is held down by the prompt, which is
 * where a length rule belongs.
 */
const MAX_OUTPUT_TOKENS = 3072;

export interface AgentReplyInput {
  /** What the client just said. */
  message: string;
  /** Recent turns, oldest first, for continuity. */
  history: { role: 'client' | 'firm'; text: string }[];
  context: ClientContext | null;
  firmName: string;
}

export interface AgentReply {
  /** The Hinglish reply to send, empty when the model wants a human. */
  reply: string;
  /** 0–1. Below the threshold the reply is discarded and a human takes over. */
  confidence: number;
  /** The model's own request for a human. Honoured whatever the confidence. */
  needsHuman: boolean;
  /** Short topic label, aggregated into the FAQ list. */
  topic: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * The system prompt.
 *
 * Two things it must never do: invent a fact about the client, or commit the
 * firm to anything. Both are stated as absolutes and both are backed by
 * mechanism elsewhere — the grounding block is the only source of client facts,
 * and commercial questions never reach this prompt at all because the
 * deterministic escalation rules fire first.
 */
const AGENT_PROMPT = `You are the support assistant for an Indian chartered accountancy firm, replying to a client on WhatsApp.

Reply in Hinglish — conversational Hindi written in the Latin alphabet, mixed with English for technical terms (GSTR-3B, ITR, TDS, PAN). This is how the firm's clients actually write, so match them. Be warm, brief, and practical. Address the client respectfully ("ji").

ABSOLUTE RULES:
1. Every fact about this client — deadlines, documents, GSTIN, filing status —
   must come from the CLIENT CONTEXT block. If the answer is not there, say you
   will check with the CA rather than guessing. Never invent a date, an amount
   or a status.
2. Never discuss fees, charges, discounts or refunds. Never promise a filing
   will be done by a date. Never give a legal opinion. If asked, set
   needs_human to true.
3. Never claim something has been filed or received unless the context says so.
4. If you are unsure for any reason, set needs_human to true. Handing a
   question to the CA is always an acceptable answer; a confident wrong answer
   is not.

Return ONLY JSON matching exactly this shape:
{
  "reply": "<the Hinglish message to send, or an empty string if a human is needed>",
  "confidence": <0.0-1.0, how sure you are the reply is correct and grounded>,
  "needs_human": <true if a person should handle this>,
  "topic": "<2-4 word English label, e.g. 'GST deadline' or 'document status'>"
}`;

@Injectable()
export class SupportAgentService {
  private readonly logger = new Logger(SupportAgentService.name);
  private genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '');
    this.modelName = this.config.get<string>('gemini.extractionModel') ?? DEFAULT_MODEL;
  }

  async reply(input: AgentReplyInput): Promise<AgentReply> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // As elsewhere: 2.5's thinking tokens are billed against the output
        // budget and truncate the JSON mid-string.
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });

    const contextBlock = input.context
      ? ClientContextService.toPromptBlock(input.context)
      : 'This contact is not a registered client yet — no client records are available.';

    const historyBlock = input.history.length
      ? input.history
          .slice(-6)
          .map((h) => `${h.role === 'client' ? 'Client' : 'Firm'}: ${h.text}`)
          .join('\n')
      : '(no earlier messages)';

    const prompt = [
      AGENT_PROMPT,
      `FIRM NAME: ${input.firmName}`,
      `CLIENT CONTEXT:\n${contextBlock}`,
      `RECENT CONVERSATION:\n${historyBlock}`,
      `CLIENT'S NEW MESSAGE:\n${input.message}`,
    ].join('\n\n');

    const result = await model.generateContent(prompt);
    const usage = result.response.usageMetadata;
    const finishReason = result.response.candidates?.[0]?.finishReason;

    if (finishReason === 'MAX_TOKENS') {
      throw new Error(`Gemini hit the ${MAX_OUTPUT_TOKENS}-token limit drafting a reply.`);
    }

    const parsed = this.parse(result.response.text());

    this.logger.log(
      `Agent reply (topic="${parsed.topic}", confidence=${parsed.confidence}, ` +
        `needsHuman=${parsed.needsHuman}, ${usage?.totalTokenCount ?? 0} tokens)`,
    );

    return {
      ...parsed,
      model: this.modelName,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }

  /**
   * Parses the model's JSON, failing safe.
   *
   * Every ambiguity resolves towards a human: unparseable output, a missing
   * confidence, or an empty reply all become needs_human. The cost of an
   * unnecessary escalation is a CA reading one message; the cost of sending a
   * malformed or ungrounded reply is a client acting on it.
   */
  private parse(raw: string): Omit<AgentReply, 'model' | 'tokensIn' | 'tokensOut'> {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        reply: '',
        confidence: 0,
        needsHuman: true,
        topic: 'unparsed reply',
      };
    }

    const reply = typeof json['reply'] === 'string' ? json['reply'].trim() : '';

    const rawConfidence = Number(json['confidence']);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0;

    const topic =
      typeof json['topic'] === 'string' && json['topic'].trim()
        ? json['topic'].trim().slice(0, 60)
        : 'general enquiry';

    // An empty reply IS a request for a human, whatever the model claimed.
    const needsHuman = json['needs_human'] === true || reply.length === 0;

    return { reply, confidence, needsHuman, topic };
  }
}
