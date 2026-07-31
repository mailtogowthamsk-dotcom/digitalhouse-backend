import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { assertReadOnlySql } = require("../../scripts/db-live-audit");

describe("db-live-audit assertReadOnlySql", () => {
  it("allows SELECT / SHOW / EXPLAIN", () => {
    expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
    expect(() => assertReadOnlySql("SHOW TABLES")).not.toThrow();
    expect(() => assertReadOnlySql("EXPLAIN SELECT id FROM posts LIMIT 1")).not.toThrow();
  });

  it("refuses DDL and write DML", () => {
    expect(() => assertReadOnlySql("ALTER TABLE users ADD COLUMN x INT")).toThrow(/non-read-only/);
    expect(() => assertReadOnlySql("DROP TABLE users")).toThrow(/non-read-only/);
    expect(() => assertReadOnlySql("DELETE FROM posts")).toThrow(/non-read-only/);
    expect(() => assertReadOnlySql("UPDATE users SET status='x'")).toThrow(/non-read-only/);
    expect(() => assertReadOnlySql("INSERT INTO posts (id) VALUES (1)")).toThrow(/non-read-only/);
    expect(() => assertReadOnlySql("TRUNCATE TABLE posts")).toThrow(/non-read-only/);
  });

  it("refuses EXPLAIN ANALYZE", () => {
    expect(() => assertReadOnlySql("EXPLAIN ANALYZE SELECT 1")).toThrow(/EXPLAIN ANALYZE/);
  });
});
