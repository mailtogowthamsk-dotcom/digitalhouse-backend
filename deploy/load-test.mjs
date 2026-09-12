#!/usr/bin/env node
/**
 * Zero-dependency load probe (Node 18+ fetch).
 *
 * On server (real capacity):
 *   node deploy/load-test.mjs
 *
 * From laptop (path latency only):
 *   BASE_URL=https://konguvettuvagounder.com/api node deploy/load-test.mjs
 *
 * Env:
 *   BASE_URL=http://127.0.0.1:4000/api
 *   DURATION=15
 *   CONNECTIONS=40
 */
const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");
const DURATION_SEC = Math.max(3, Number(process.env.DURATION || 15));
const CONNECTIONS = Math.max(1, Number(process.env.CONNECTIONS || 40));

async function smoke(path) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}${path}`);
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t0, body: text.slice(0, 120) };
}

async function hammer(path, connections, durationSec) {
  const url = `${BASE_URL}${path}`;
  const end = Date.now() + durationSec * 1000;
  let ok = 0;
  let fail = 0;
  const latencies = [];
  const statusCount = new Map();

  async function worker() {
    while (Date.now() < end) {
      const t0 = Date.now();
      try {
        const res = await fetch(url);
        const ms = Date.now() - t0;
        latencies.push(ms);
        statusCount.set(res.status, (statusCount.get(res.status) || 0) + 1);
        // Drain body so sockets recycle cleanly
        await res.arrayBuffer();
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
        latencies.push(Date.now() - t0);
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
    path,
    connections,
    durationSec: elapsed,
    total,
    ok,
    fail,
    rps: total / elapsed,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: latencies[latencies.length - 1] || 0,
    statuses: Object.fromEntries(statusCount)
  };
}

function printResult(title, r) {
  console.log(`--- ${title} ---`);
  console.log(
    `GET ${r.path}  conn=${r.connections}  ~${r.durationSec.toFixed(1)}s  ` +
      `rps=${r.rps.toFixed(1)}  ok=${r.ok} fail=${r.fail}`
  );
  console.log(
    `latency ms  p50=${r.p50}  p95=${r.p95}  p99=${r.p99}  max=${r.max}  statuses=${JSON.stringify(r.statuses)}`
  );
  console.log("");
}

async function main() {
  console.log("=== Digital House load test ===");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`DURATION=${DURATION_SEC}s  CONNECTIONS=${CONNECTIONS}`);
  console.log("");

  console.log("--- 0) Health smoke ---");
  try {
    const s = await smoke("/health");
    console.log(`HTTP ${s.status}  ${s.ms}ms  ${s.body}`);
  } catch (e) {
    console.error("Health failed:", e.message || e);
    process.exit(1);
  }
  console.log("");

  const scenarios = [
    ["1) Health @ 20", "/health", 20],
    [`2) Health @ ${CONNECTIONS}`, "/health", CONNECTIONS],
    ["3) Options kulams (DB)", "/options/kulams", Math.max(5, Math.floor(CONNECTIONS / 2))],
    ["4) Landing", "/landing", Math.max(5, Math.floor(CONNECTIONS / 2))]
  ];

  for (const [title, path, conn] of scenarios) {
    const r = await hammer(path, conn, DURATION_SEC);
    printResult(title, r);
  }

  console.log("=== Read results ===");
  console.log("  Localhost: p99 < ~100ms @ 40–80 conn → server/DB healthy");
  console.log("  Public URL: high ms = CF/network; use server localhost for capacity");
  console.log("  fail/5xx rising → lower CONNECTIONS or apply Phase-1 pools first");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
