import { describe, expect, it } from "vitest";
import { timedMs } from "../../src/utils/perfTimer";

describe("perfTimer.timedMs", () => {
  it("returns elapsed ms without changing result", async () => {
    const { value, ms } = await timedMs(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    });
    expect(value).toBe(42);
    expect(ms).toBeGreaterThanOrEqual(15);
  });
});
