import { describe, it, expect } from "vitest";
import { integrationEnabled, useTestDatabase } from "../setup/db";

/**
 * Live equivalence: single-aggregate vs legacy 6× COUNT must match.
 * Skipped unless RUN_INTEGRATION_TESTS=1 with a real MySQL schema.
 */
describe.skipIf(!integrationEnabled())("integration — quickActionCounts equivalence", () => {
  useTestDatabase();

  it("aggregate matches legacy six COUNT queries", async () => {
    const {
      getQuickActionCounts,
      getQuickActionCountsLegacySixQueries
    } = await import("../../src/services/Home.service");
    const [next, legacy] = await Promise.all([
      getQuickActionCounts(),
      getQuickActionCountsLegacySixQueries()
    ]);
    expect(next).toEqual(legacy);
  });
});
