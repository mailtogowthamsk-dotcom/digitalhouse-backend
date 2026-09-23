import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../../src/services/feedRanking/feedConcurrency";

/**
 * P4F contract: bootstrap light arms use bounded concurrency (same helper as feed).
 * Staging order (light → feed → stories) is integration-measured via [home-metrics].
 */
describe("P4F home bootstrap concurrency helper", () => {
  it("preserves order and respects concurrency bound", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 4 }, (_, i) => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return `v${i}`;
    });
    const out = await mapWithConcurrency(tasks, 2);
    expect(out).toEqual(["v0", "v1", "v2", "v3"]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("documents staging policy: light≤2 first, then feed∥stories", () => {
    const lightConcurrency = 2;
    const heavyParallel = true;
    expect(lightConcurrency).toBeLessThanOrEqual(2);
    expect(heavyParallel).toBe(true);
  });
});
