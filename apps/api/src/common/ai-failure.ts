/**
 * Why an AI job could not finish, in words a person can act on: credit used
 * up, a limit reached, a refused key, no connection. For the jobs that answer
 * a person (Ask your books, the monthly summary, a quote from a message,
 * invoice wording), so a failure ends the wait with a reason instead of
 * leaving the screen spinning. Document reading has its own wording
 * (readFailureReason in extraction.service).
 */
/** An error from the AI provider itself (credit, limit, key, connection), rather than from our own code. */
export function isAiProviderError(error: unknown): boolean {
  const e = String(error instanceof Error ? error.message : error).toLowerCase();
  return /\b(401|402|403|429)\b|payment required|credits? (are )?depleted|billing|prepay|quota|rate limit|resource.?exhausted|too many requests|api key|permission denied|unauthori[sz]ed|generativelanguage|googlegenerativeai/.test(e);
}

export function aiFailureReason(error: unknown): string {
  const e = String(error instanceof Error ? error.message : error).toLowerCase();
  if (/\b402\b|payment required|credits? (are )?depleted|billing|prepay/.test(e)) {
    return 'The AI service has no credit left. Top up the AI account (Google AI Studio for Gemini), then try again.';
  }
  if (/\b429\b|quota|rate limit|resource.?exhausted|too many requests/.test(e)) {
    return 'The AI service is over its limit just now. Try again in a few minutes.';
  }
  if (/\b40[13]\b|api key|permission denied|unauthori[sz]ed/.test(e)) {
    return 'The AI key was refused. Check GEMINI_API_KEY in the server settings.';
  }
  if (/fetch failed|enotfound|econn|etimedout|network|timeout/.test(e)) {
    return 'The AI service could not be reached. Try again when the connection is back.';
  }
  return 'The AI could not answer just now. Try again.';
}
