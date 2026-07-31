import type { Response } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * HTTP smoke via SuperTest — mounts a minimal Express app without DB gate.
 * Full `app` import pulls rate limits / DB readiness; keep this focused.
 */
describe("integration — HTTP health (no DB)", () => {
  let app: import("express").Express;

  beforeAll(async () => {
    const express = (await import("express")).default;
    app = express();
    app.get("/health", (_req, res: Response) => {
      res.status(200).json({ ok: true, status: "up" });
    });
  });

  it("responds to GET /health", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ ok: true, status: "up" });
  });
});

describe("integration — Redis mock presence pattern", () => {
  it("can stand in for an in-memory presence registry", async () => {
    const { createRedisMock } = await import("../mocks/redis.mock");
    const redis = createRedisMock();
    await redis.set("presence:user:1", JSON.stringify({ online: true }));
    const raw = await redis.get("presence:user:1");
    expect(JSON.parse(raw!)).toEqual({ online: true });
    expect(vi.isMockFunction(redis.set)).toBe(true);
  });
});
