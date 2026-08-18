import { describe, expect, it } from "vitest";
import { otherPartyId, uniqueByOtherUser } from "../../src/services/connectionPair";

describe("connection pair dedupe", () => {
  it("treats A→B and B→A as the same other person", () => {
    expect(otherPartyId(10, 10, 22)).toBe(22);
    expect(otherPartyId(10, 22, 10)).toBe(22);
  });

  it("keeps one row per person when both directed ACCEPTED rows exist", () => {
    const rows = [
      { id: 2, requesterUserId: 22, recipientUserId: 10, updatedAt: "newer" },
      { id: 1, requesterUserId: 10, recipientUserId: 22, updatedAt: "older" }
    ];
    const unique = uniqueByOtherUser(10, rows, (r) => r);
    expect(unique).toHaveLength(1);
    expect(unique[0]?.id).toBe(2);
  });
});
