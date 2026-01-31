#!/usr/bin/env node
/**
 * Generate a secure random ADMIN_API_KEY.
 * Run: node scripts/generate-admin-key.js
 * Then copy the output into your .env as ADMIN_API_KEY=<output>
 */
const crypto = require("crypto");

// 32 bytes = 64 hex chars; safe for API key
const key = crypto.randomBytes(32).toString("hex");

console.log("\nGenerated ADMIN_API_KEY (copy this into backend/.env):\n");
console.log("ADMIN_API_KEY=" + key);
console.log("\n");
