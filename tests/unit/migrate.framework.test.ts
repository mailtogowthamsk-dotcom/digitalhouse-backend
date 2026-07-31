import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { splitSqlStatements } = require("../../scripts/migrate/sql");
const { discoverMigrations } = require("../../scripts/migrate/discover");

describe("migrate sql splitter", () => {
  it("splits statements and strips line comments", () => {
    const stmts = splitSqlStatements(`
      -- header
      CREATE TABLE a (id INT);
      CREATE TABLE b (id INT); -- trailing
    `);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatch(/CREATE TABLE a/i);
  });
});

describe("migrate discovery", () => {
  it("finds versioned media_jobs migration", () => {
    const list = discoverMigrations();
    expect(list.some((m: { folder: string }) => m.folder.includes("media_jobs_queue"))).toBe(
      true
    );
    expect(list[0].version).toMatch(/^\d{14}$/);
  });
});
