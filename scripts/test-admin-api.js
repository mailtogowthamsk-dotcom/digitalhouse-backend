#!/usr/bin/env node
/**
 * Test admin API using the key from .env.
 * Run from backend folder: node scripts/test-admin-api.js
 * Requires: backend running (npm run dev), and .env with ADMIN_API_KEY set.
 */
const path = require("path");
const fs = require("fs");

// Load .env manually (same as server)
const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.readFileSync(envPath, "utf8");
let ADMIN_API_KEY = "";
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("ADMIN_API_KEY=") && !trimmed.startsWith("#")) {
    ADMIN_API_KEY = trimmed.slice("ADMIN_API_KEY=".length).replace(/\r/g, "").trim();
    break;
  }
}

if (!ADMIN_API_KEY) {
  console.error("ADMIN_API_KEY not found in .env");
  process.exit(1);
}

const baseUrl = process.env.API_BASE_URL || "http://localhost:4000/api";
const url = `${baseUrl}/admin/pending`;

console.log("Testing admin API:", url);
console.log("Key length:", ADMIN_API_KEY.length);

fetch(url, {
  method: "GET",
  headers: { "X-Admin-Key": ADMIN_API_KEY }
})
  .then((r) => r.json())
  .then((data) => {
    console.log("Response:", data);
    if (data.ok) console.log("\nSuccess! Admin key works.");
    else console.log("\nFailed:", data.message);
  })
  .catch((err) => {
    console.error("Request failed:", err.message);
    console.log("Is the backend running? (npm run dev)");
  });
