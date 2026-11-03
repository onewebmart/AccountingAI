/**
 * Who an invoice or bill was issued to, as that party stood at the time.
 *
 * GST returns and registers print the party's GSTIN and state. Those were
 * read off the customer or vendor as they are now, so correcting a GSTIN
 * rewrote returns for months already filed. Before a party's name, GSTIN or
 * state changes, its issued documents are stamped with the old values; a
 * document with no stamp was issued to the party as it still is.
 */
export interface PartyAsIssued {
  name: string;
  gstin: string | null;
  /** GST state code; vendors have none of their own beyond their GSTIN's. */
  stateCode: string | null;
}

export function partyAsIssued(
  doc: { partyAtIssue?: PartyAsIssued | null },
  party: { name?: string | null; gstin?: string | null; stateCode?: string | null } | null | undefined,
  unknownName: string,
): PartyAsIssued {
  if (doc.partyAtIssue) return doc.partyAtIssue;
  return { name: party?.name ?? unknownName, gstin: party?.gstin ?? null, stateCode: party?.stateCode ?? null };
}
