import dotenv from "dotenv";
import path from "path";

// Load .env from backend folder (same folder as package.json)
const envPath = path.resolve(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * IMPORTANT: use require() (not ESM import) so dotenv.config runs BEFORE
 * production validation reads process.env. Static imports are hoisted.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertProductionSecurityEnv } = require("./productionSecurity") as typeof import("./productionSecurity");
assertProductionSecurityEnv();
