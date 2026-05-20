#!/usr/bin/env node
/**
 * Check API health endpoint.
 * Usage:
 *   API_URL=https://www.infosensetechnologies.com/digitalhouse/backend/api npm run verify:health
 *   API_URL=http://127.0.0.1:4000/api npm run verify:health
 */
const base = (process.env.API_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");
const url = `${base}/health`;

console.log("GET", url);

fetch(url, { method: "GET" })
  .then(async (res) => {
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("Non-JSON response (status", res.status + "):");
      console.error(text.slice(0, 500));
      process.exit(1);
    }
    console.log("Status:", res.status);
    console.log("Body:", JSON.stringify(data, null, 2));
    if (!res.ok || !data.ok) {
      console.error("\nHealth check failed.");
      process.exit(1);
    }
    if (data.ready === false || data.dbFailed === true) {
      console.error("\nAPI up but not ready (DB issue?).");
      process.exit(1);
    }
    console.log("\nHealth check passed.");
  })
  .catch((e) => {
    console.error("Request failed:", e.message);
    process.exit(1);
  });
