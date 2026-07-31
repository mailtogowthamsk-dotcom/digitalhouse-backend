import { describe, it, expect } from "vitest";
import { integrationEnabled, useTestDatabase } from "../setup/db";

/**
 * Integration suite — skipped unless RUN_INTEGRATION_TESTS=1.
 *
 * Prerequisites:
 *   - MySQL test database (prefer a disposable schema)
 *   - Env: TEST_DB_NAME / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_HOST
 *     or DB_* pointing at the test schema
 *
 * Example:
 *   RUN_INTEGRATION_TESTS=1 npm run test:integration
 */
describe.skipIf(!integrationEnabled())("integration — database connectivity", () => {
  useTestDatabase();

  it("authenticates Sequelize against the test database", async () => {
    const { sequelize } = await import("../../src/config/db");
    await expect(sequelize.authenticate()).resolves.toBeUndefined();
    const [rows] = (await sequelize.query("SELECT 1 AS ok")) as [Array<{ ok: number }>, unknown];
    expect(Number(rows[0]?.ok)).toBe(1);
  });

  it("loads model associations without throwing", async () => {
    const models = await import("../../src/models");
    expect(models.User).toBeTruthy();
    expect(models.Post).toBeTruthy();
    expect(models.MatrimonyReviewAudit).toBeTruthy();
  });
});

describe.skipIf(!integrationEnabled())("integration — R2 mock wiring example", () => {
  it("documents vi.mock pattern for R2 in integration flows", async () => {
    // Real R2 must never be called from CI. Prefer createR2MockModule() at file top.
    const { createR2MockFns } = await import("../mocks/r2.mock");
    const r2 = createR2MockFns();
    const url = await r2.getPresignedPutUrl("digital-house/test/obj.bin", "application/octet-stream");
    expect(url).toContain("r2.test.local");
  });
});
