#!/usr/bin/env node
/**
 * Zero-dependency load probe (Node 18+ fetch).
 * Reads credentials from backend/.env (via load-test.sh or dotenv-lite below).
 *
 * On server:
 *   bash deploy/load-test.sh
 *   DURATION=30 CONNECTIONS=50 bash deploy/load-test.sh
 *
 * Env (from .env or shell):
 *   BASE_URL, DURATION, CONNECTIONS
 *   LOAD_TEST_EMAIL / LOAD_TEST_PASSWORD  (preferred)
 *   or ADMIN_EMAILS (first) + ADMIN_PASSWORD
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
const DURATION_SEC = Math.max(3, Number(process.env.DURATION || 15));
const CONNECTIONS = Math.max(1, Number(process.env.CONNECTIONS || 40));

function resolveLoginCredentials() {
  const email =
    (process.env.LOAD_TEST_EMAIL || "").trim() ||
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] ||
    "";
  const password =
    (process.env.LOAD_TEST_PASSWORD || "").trim() ||
    (process.env.ADMIN_PASSWORD || "").trim() ||
    "";
  return { email, password };
}

async function smoke(pathName, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}${pathName}`, { headers });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t0, body: text.slice(0, 120) };
}

async function adminLogin(email, password) {
  const res = await fetch(`${BASE_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  const token = json?.token || json?.data?.token || json?.accessToken;
  if (!token) throw new Error("Login OK but no token in response");
  return String(token);
}

async function hammer(pathName, connections, durationSec, headers = {}) {
  const url = `${BASE_URL}${pathName}`;
  const end = Date.now() + durationSec * 1000;
  let ok = 0;
  let fail = 0;
  const latencies = [];
  const statusCount = new Map();

  async function worker() {
    while (Date.now() < end) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { headers });
        const ms = Date.now() - t0;
        latencies.push(ms);
        statusCount.set(res.status, (statusCount.get(res.status) || 0) + 1);
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
    path: pathName,
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
  const { email, password } = resolveLoginCredentials();

  console.log("=== Digital House load test ===");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`DURATION=${DURATION_SEC}s  CONNECTIONS=${CONNECTIONS}`);
  console.log(
    `auth user=${email ? email : "(none)"}  password=${password ? "(from .env)" : "(missing)"}`
  );
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

  let authHeaders = {};
  if (email && password) {
    console.log("--- 0b) Admin login (.env credentials) ---");
    try {
      const token = await adminLogin(email, password);
      authHeaders = { Authorization: `Bearer ${token}` };
      console.log("Login OK — token acquired (not printed)");
    } catch (e) {
      console.warn("Login skipped/failed:", e.message || e);
      console.warn("Public endpoints only. Check ADMIN_EMAILS/ADMIN_PASSWORD or LOAD_TEST_* on server .env");
    }
    console.log("");
  } else {
    console.log("--- 0b) No ADMIN_EMAILS/ADMIN_PASSWORD (or LOAD_TEST_*) in .env — public only ---");
    console.log("");
  }

  const scenarios = [
    ["1) Health @ 20", "/health", 20, {}],
    [`2) Health @ ${CONNECTIONS}`, "/health", CONNECTIONS, {}],
    ["3) Options kulams (DB)", "/options/kulams", Math.max(5, Math.floor(CONNECTIONS / 2)), {}],
    ["4) Landing", "/landing", Math.max(5, Math.floor(CONNECTIONS / 2)), {}]
  ];

  if (authHeaders.Authorization) {
    scenarios.push([
      "5) Admin settings/me (auth)",
      "/admin/settings/me",
      Math.max(5, Math.floor(CONNECTIONS / 3)),
      authHeaders
    ]);
    scenarios.push([
      "6) Admin scheduler jobs (auth)",
      "/admin/scheduler/jobs",
      Math.max(3, Math.floor(CONNECTIONS / 4)),
      authHeaders
    ]);
  }

  for (const [title, pathName, conn, headers] of scenarios) {
    const r = await hammer(pathName, conn, DURATION_SEC, headers);
    printResult(title, r);
  }

  console.log("=== Read results ===");
  console.log("  Localhost: p99 < ~100ms @ 40–80 conn → server/DB healthy");
  console.log("  Public URL: high ms = CF/network; use server localhost for capacity");
  console.log("  fail/5xx rising → lower CONNECTIONS");
  console.log("  Credentials: LOAD_TEST_EMAIL/PASSWORD or first ADMIN_EMAILS + ADMIN_PASSWORD");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
