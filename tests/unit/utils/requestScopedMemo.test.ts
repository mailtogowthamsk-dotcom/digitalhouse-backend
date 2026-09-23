import { describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "../../../src/utils/requestContext";
import {
  memoAcceptedConnectionUserIds,
  memoBlockedUserIds
} from "../../../src/utils/requestScopedMemo";

describe("requestScopedMemo (P4G)", () => {
  it("dedupes connection id loads within one request", async () => {
    const loader = vi.fn(async () => [2, 3, 4]);
    await runWithRequestContext({ requestId: "t1" }, async () => {
      const a = await memoAcceptedConnectionUserIds(1, loader);
      const b = await memoAcceptedConnectionUserIds(1, loader);
      expect(a).toEqual([2, 3, 4]);
      expect(b).toEqual([2, 3, 4]);
      expect(loader).toHaveBeenCalledTimes(1);
      // Callers get defensive copies
      a.push(99);
      expect(b).toEqual([2, 3, 4]);
    });
  });

  it("does not share memo across requests", async () => {
    const loader = vi.fn(async () => [9]);
    await runWithRequestContext({ requestId: "r1" }, async () => {
      await memoAcceptedConnectionUserIds(1, loader);
    });
    await runWithRequestContext({ requestId: "r2" }, async () => {
      await memoAcceptedConnectionUserIds(1, loader);
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("dedupes blocked ids and returns a fresh Set", async () => {
    const loader = vi.fn(async () => new Set([5, 6]));
    await runWithRequestContext({ requestId: "t2" }, async () => {
      const a = await memoBlockedUserIds(1, loader);
      const b = await memoBlockedUserIds(1, loader);
      expect([...a].sort()).toEqual([5, 6]);
      expect([...b].sort()).toEqual([5, 6]);
      expect(loader).toHaveBeenCalledTimes(1);
      a.add(7);
      expect(b.has(7)).toBe(false);
    });
  });

  it("falls through without ALS (no memo)", async () => {
    const loader = vi.fn(async () => [1]);
    await memoAcceptedConnectionUserIds(1, loader);
    await memoAcceptedConnectionUserIds(1, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
