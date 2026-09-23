#!/usr/bin/env node
/**
 * Phase 3K/L/M — Home-focused staging load probe (extends deploy/load-test.mjs patterns).
 *
 * NEVER point at production without explicit override.
 *
 * Required:
 *   BASE_URL=http://127.0.0.1:4000/api   (or staging)
 *   LOAD_TEST_ALLOW_REMOTE=1             (if BASE_URL is not localhost)
 *
 * Auth (member JWT — OTP login cannot be automated safely):
 *   LOAD_TEST_JWT=<member bearer token>
 *   OR LOAD_TEST_MEMBER_TOKEN=<same>
 *
 * Optional:
 *   CONNECTIONS=5|10|25|50|100
 *   DURATION=10
 *   SCENARIO=cold_home|refresh|feed|stories|quick_actions|all
 *
 * Metrics: concurrency, totals, 4xx/5xx, timeouts, rps, p50/p95/p99/max.
 * DB pool / Node CPU / event-loop: NOT MEASURED here (see /api/health? DB_POOL_DEBUG + PM2).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");
const DURATION_SEC = Math.max(3, Number(process.env.DURATION || 10));
const CONNECTIONS = Math.max(1, Number(process.env.CONNECTIONS || 5));
const SCENARIO = (process.env.SCENARIO || "all").toLowerCase();
const JWT =
  (process.env.LOAD_TEST_JWT || process.env.LOAD_TEST_MEMBER_TOKEN || "").trim();

function assertSafeTarget() {
  const host = (() => {
    try {
      return new URL(BASE_URL).hostname;
    } catch {
      return "";
    }
  })();
  const local =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.");
  if (!local && process.env.LOAD_TEST_ALLOW_REMOTE !== "1") {
    console.error(
      "Refusing non-local BASE_URL. Set LOAD_TEST_ALLOW_REMOTE=1 for staging only."
    );
    process.exit(2);
  }
  if (/konguvettuvagounder\.com|infosensetechnologies\.com/i.test(BASE_URL)) {
    if (process.env.LOAD_TEST_ALLOW_PRODUCTION !== "1") {
      console.error(
        "Refusing production-looking BASE_URL. Set LOAD_TEST_ALLOW_PRODUCTION=1 only if intentional."
      );
      process.exit(2);
    }
  }
}

async function hammer(pathName, connections, durationSec, headers = {}) {
  const url = `${BASE_URL}${pathName}`;
  const end = Date.now() + durationSec * 1000;
  let ok = 0;
  let fail = 0;
  let timeout = 0;
  let s4 = 0;
  let s5 = 0;
  const latencies = [];
  const statusCount = new Map();

  async function worker() {
    while (Date.now() < end) {
      const t0 = Date.now();
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 30000);
      try {
        const res = await fetch(url, { headers, signal: ac.signal });
        const ms = Date.now() - t0;
        latencies.push(ms);
        statusCount.set(res.status, (statusCount.get(res.status) || 0) + 1);
        await res.arrayBuffer();
        if (res.status >= 500) s5 += 1;
        else if (res.status >= 400) s4 += 1;
        if (res.ok) ok += 1;
        else fail += 1;
      } catch (e) {
        const ms = Date.now() - t0;
        latencies.push(ms);
        fail += 1;
        if (e?.name === "AbortError" || String(e?.message || "").includes("abort")) {
          timeout += 1;
        }
      } finally {
        clearTimeout(to);
      }
    }
  }

  const tStart = Date.now();
  await Promise.all(Array.from({ length: connections }, () => worker()));
  const elapsed = (Date.now() - tStart) / 1000;
  const total = ok + fail;
  latencies.sort((a, b) => a - b);
  const pct = (p) =>
    latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]
      : 0;

  return {
    path: pathName,
    concurrency: connections,
    durationSec: elapsed,
    totalRequests: total,
    successful: ok,
    failed: fail,
    status4xx: s4,
    status5xx: s5,
    timeouts: timeout,
    rps: total / Math.max(0.001, elapsed),
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: latencies[latencies.length - 1] || 0,
    statuses: Object.fromEntries(statusCount),
    dbPool: "NOT MEASURED — poll /api/health with DB_POOL_DEBUG=true during run",
    nodeCpu: "NOT MEASURED — use `pm2 monit` / OS tools",
    nodeMemory: "NOT MEASURED — use `pm2 monit` / OS tools",
    eventLoopLag: "NOT MEASURED — no event-loop probe in this harness",
    connectionWait: "NOT MEASURED — enable DB_POOL_DEBUG for acquireWaitP50/P95 in API logs"
  };
}

function printResult(title, r) {
  console.log(`--- ${title} ---`);
  console.log(JSON.stringify(r, null, 2));
  console.log("");
}

async function main() {
  assertSafeTarget();
  console.log("=== Digital House HOME load test (Phase 3K/L/M) ===");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`DURATION=${DURATION_SEC}s  CONNECTIONS=${CONNECTIONS}  SCENARIO=${SCENARIO}`);
  console.log(`JWT=${JWT ? "(set)" : "(missing — authenticated scenarios will 401)"}`);
  console.log("");

  const auth = JWT ? { Authorization: `Bearer ${JWT}` } : {};

  const all = [
    ["A cold_home", "/home/bootstrap?limit=6", "cold_home"],
    ["B refresh_summary", "/home/summary", "refresh"],
    ["C feed", "/home/feed?limit=6&sort=recent", "feed"],
    ["D stories", "/stories", "stories"],
    ["E quick_actions", "/home/quick-actions", "quick_actions"]
  ];

  const selected = all.filter(([, , key]) => SCENARIO === "all" || SCENARIO === key);

  if (!JWT) {
    console.warn("No LOAD_TEST_JWT — skipping authenticated Home scenarios.");
    console.warn("Export a member JWT from a staging login session.");
    process.exit(0);
  }

  for (const [title, pathName] of selected) {
    const r = await hammer(pathName, CONNECTIONS, DURATION_SEC, auth);
    printResult(title, r);
  }

  console.log("Suggested matrix: CONNECTIONS=5,10,25,50,100 with DURATION=10 each.");
  console.log("Scenario H (slowdown/retry storm): temporarily set DB_POOL_MAX=1 + watch [DUPLICATE-REQUEST] / client retries — NOT automated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
