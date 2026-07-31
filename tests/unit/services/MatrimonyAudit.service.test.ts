import { describe, it, expect, vi, beforeEach } from "vitest";

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (row: unknown) => row)
}));

vi.mock("../../../src/models", () => ({
  MatrimonyReviewAudit: {
    create
  }
}));

import { writeAudit } from "../../../src/services/MatrimonyAudit.service";

describe("MatrimonyAudit.service", () => {
  beforeEach(() => {
    create.mockClear();
  });

  it("persists an audit row with null payload when omitted", async () => {
    await writeAudit(42, 7, "SUBMITTED", "user");

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      userId: 42,
      pendingUpdateId: 7,
      action: "SUBMITTED",
      createdBy: "user",
      payload: null
    });
    expect(arg.createdAt).toBeInstanceOf(Date);
  });

  it("forwards payload and null pendingUpdateId for lifecycle events", async () => {
    await writeAudit(9, null, "PAUSED", "user", { reason: "travel" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        pendingUpdateId: null,
        action: "PAUSED",
        createdBy: "user",
        payload: { reason: "travel" }
      })
    );
  });
});
