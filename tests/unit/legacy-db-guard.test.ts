import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { isLegacyAllowed } = require("../../scripts/legacy-db-guard");

describe("legacy-db-guard", () => {
  const original = process.env.ALLOW_LEGACY_DB_SCRIPTS;

  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_LEGACY_DB_SCRIPTS;
    else process.env.ALLOW_LEGACY_DB_SCRIPTS = original;
  });

  it("refuses when ALLOW_LEGACY_DB_SCRIPTS is unset", () => {
    delete process.env.ALLOW_LEGACY_DB_SCRIPTS;
    expect(isLegacyAllowed()).toBe(false);
  });

  it("refuses when ALLOW_LEGACY_DB_SCRIPTS is not exactly 1", () => {
    process.env.ALLOW_LEGACY_DB_SCRIPTS = "true";
    expect(isLegacyAllowed()).toBe(false);
    process.env.ALLOW_LEGACY_DB_SCRIPTS = "0";
    expect(isLegacyAllowed()).toBe(false);
  });

  it("allows when ALLOW_LEGACY_DB_SCRIPTS=1", () => {
    process.env.ALLOW_LEGACY_DB_SCRIPTS = "1";
    expect(isLegacyAllowed()).toBe(true);
  });
});
