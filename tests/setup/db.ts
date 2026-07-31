/**
 * Database helpers for integration tests.
 *
 * Usage:
 *   RUN_INTEGRATION_TESTS=1 TEST_DB_NAME=digitalhouse_test npm run test:integration
 *
 * Unit/controller tests must NOT call these — they should mock models instead.
 */
import { beforeAll, afterAll } from "vitest";

export function integrationEnabled(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === "1" || process.env.RUN_INTEGRATION_TESTS === "true";
}

/**
 * Skip the current describe/it when integration DB is not configured.
 * Call at the top of an integration suite:
 *   describe.skipIf(!integrationEnabled())("...", () => { ... })
 */
export async function connectTestDb(): Promise<{
  sequelize: typeof import("../../src/config/db").sequelize;
}> {
  if (!integrationEnabled()) {
    throw new Error("connectTestDb called without RUN_INTEGRATION_TESTS=1");
  }
  // Import after env setup so pool profile is "test"
  const { sequelize } = await import("../../src/config/db");
  await sequelize.authenticate();
  // Load model associations
  await import("../../src/models");
  return { sequelize };
}

export async function closeTestDb(): Promise<void> {
  try {
    const { sequelize } = await import("../../src/config/db");
    await sequelize.close();
  } catch {
    // ignore — may never have connected
  }
}

/** Register lifecycle hooks for a single integration file. */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await connectTestDb();
  }, 60_000);

  afterAll(async () => {
    await closeTestDb();
  }, 30_000);
}
