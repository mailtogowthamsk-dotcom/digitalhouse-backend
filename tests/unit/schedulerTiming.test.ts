import assert from "assert";
import { msUntilPhaseAlignedRun } from "../../src/utils/schedulerTiming";

function testMsUntilPhaseAlignedRun() {
  // Fixed "now" = 2026-09-21T12:10:00.000Z → 10 min into the hour
  const now = Date.parse("2026-09-21T12:10:00.000Z");
  const hour = 60 * 60 * 1000;

  // Phase :05 → next is 12:05 next hour = 55 min
  assert.strictEqual(msUntilPhaseAlignedRun(hour, 5 * 60_000, now), 55 * 60_000);

  // Phase :20 → same hour in 10 min
  assert.strictEqual(msUntilPhaseAlignedRun(hour, 20 * 60_000, now), 10 * 60_000);

  // Phase :10 exactly now → wait full interval
  assert.strictEqual(msUntilPhaseAlignedRun(hour, 10 * 60_000, now), hour);

  // 15-min window: now at +10m into a 15m bucket (12:10 → elapsed 10m)
  const fifteen = 15 * 60_000;
  // phase +3m → next bucket :03 = 8 min wait (15-10+3)
  assert.strictEqual(msUntilPhaseAlignedRun(fifteen, 3 * 60_000, now), 8 * 60_000);

  console.log("schedulerTiming ok");
}

testMsUntilPhaseAlignedRun();
