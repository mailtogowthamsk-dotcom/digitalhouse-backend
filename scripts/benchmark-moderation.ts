#!/usr/bin/env npx ts-node
/**
 * Controlled benchmark runner. Point at a local folder of YOUR images.
 * Do not commit prohibited or personal media.
 *
 *   npx ts-node --transpile-only scripts/benchmark-moderation.ts /path/to/images
 *
 * Measures latency only unless you pass a labels.json map of filename → SAFE|BLOCK|REVIEW.
 */
import fs from "fs";
import path from "path";
import { classifyImageBuffer } from "../src/services/contentSafety/localProvider";
import { evaluateModeration, policyVerdictToSafetyDecision } from "../src/services/contentSafety/policyEngine";

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: ts-node scripts/benchmark-moderation.ts /path/to/images");
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const started = Date.now();
  let n = 0;
  const decisions: Record<string, number> = {};
  for (const file of files) {
    const buf = fs.readFileSync(path.join(dir, file));
    const t0 = Date.now();
    const result = await classifyImageBuffer(buf);
    const policy = evaluateModeration(result);
    const decision = policyVerdictToSafetyDecision(policy.verdict);
    decisions[decision] = (decisions[decision] || 0) + 1;
    n += 1;
    console.log(
      JSON.stringify({
        file,
        ms: Date.now() - t0,
        category: result.category,
        confidence: result.confidence,
        decision,
        reason: policy.reason,
        failed: result.failed,
        timeout: result.timeout
      })
    );
  }
  console.log(
    JSON.stringify({
      files: n,
      totalMs: Date.now() - started,
      avgMs: n ? Math.round((Date.now() - started) / n) : 0,
      decisions
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
