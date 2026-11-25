// A sales document's Bill To / Ship To text (SAP Address / Address2), built the same way on the screen and the server:
// Address Line 1 .. 4 (SAP Street / StreetNo / Block / City) one per line, then the rest of the chosen SAP address
// (county / state / zip code, country). Empty lines are left out; at most 254 characters, as in SAP.

export function buildAddressText(lines: (string | null | undefined)[], tail: string | null | undefined): string {
  return [...lines, tail]
    .map((l) => (l ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 254);
}
