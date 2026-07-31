import type { Response } from "express";
import { vi } from "vitest";

/** Minimal Express Response mock for controller unit tests. */
export function createMockResponse() {
  const res: Partial<Response> & {
    statusCode: number;
    body: unknown;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function status(this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(this: typeof res, payload: unknown) {
      this.body = payload;
      return this;
    })
  };
  return res as Response & { statusCode: number; body: unknown };
}

export function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    fullName: "Test User",
    email: "test@example.com",
    status: "APPROVED",
    community: "TEST",
    ...overrides
  };
}
