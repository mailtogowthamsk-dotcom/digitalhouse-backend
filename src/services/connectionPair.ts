/** Directed rows (A→B and B→A) are unique in SQL; the unordered pair is not. */

export function otherPartyId(
  userId: number,
  requesterUserId: number,
  recipientUserId: number
): number {
  return requesterUserId === userId ? recipientUserId : requesterUserId;
}

export function uniqueByOtherUser<T>(
  userId: number,
  rows: T[],
  ids: (row: T) => { requesterUserId: number; recipientUserId: number }
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    const { requesterUserId, recipientUserId } = ids(row);
    const other = otherPartyId(userId, requesterUserId, recipientUserId);
    if (!other || seen.has(other)) continue;
    seen.add(other);
    out.push(row);
  }
  return out;
}
