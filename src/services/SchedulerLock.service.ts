/**
 * Cross-process job locks via MySQL GET_LOCK.
 *
 * Holds one Sequelize-managed connection for the job duration (via transaction)
 * so the session lock stays valid until RELEASE_LOCK.
 *
 * Do NOT use raw pool connection.query() + await — mysql2 callback connections
 * throw: "await on the result of query that is not a promise".
 */
import { QueryTypes } from "sequelize";
import { sequelize } from "../config/db";

function lockNameFor(jobKey: string): string {
  return `dh_sched_${jobKey}`.slice(0, 64);
}

export type LockResult<T> =
  | { acquired: true; result: T }
  | { acquired: false; result?: undefined };

/**
 * Non-blocking lock. If another process holds the lock, returns acquired:false immediately.
 */
export async function withSchedulerLock<T>(
  jobKey: string,
  work: () => Promise<T>
): Promise<LockResult<T>> {
  const name = lockNameFor(jobKey);

  return sequelize.transaction(async (transaction) => {
    const rows = await sequelize.query<{ acquired: number | string }>(
      "SELECT GET_LOCK(?, 0) AS acquired",
      {
        replacements: [name],
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) {
      return { acquired: false as const };
    }

    try {
      const result = await work();
      return { acquired: true as const, result };
    } finally {
      try {
        await sequelize.query("SELECT RELEASE_LOCK(?) AS released", {
          replacements: [name],
          type: QueryTypes.SELECT,
          transaction
        });
      } catch (err) {
        console.warn(
          `[scheduler-lock] RELEASE_LOCK failed for ${jobKey}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  });
}
