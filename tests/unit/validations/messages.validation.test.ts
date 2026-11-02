import { describe, expect, it } from "vitest";
import { sendMessageSchema } from "../../../src/validations/messages.validation";

describe("sendMessageSchema", () => {
  it("accepts a text-only message", () => {
    const parsed = sendMessageSchema.parse({ recipientId: 2, body: "Hello" });
    expect(parsed.body).toBe("Hello");
    expect(parsed.sharedPostId).toBeUndefined();
  });

  it("accepts a shared post without body", () => {
    const parsed = sendMessageSchema.parse({ recipientId: 2, sharedPostId: 44 });
    expect(parsed.body).toBe("");
    expect(parsed.sharedPostId).toBe(44);
  });

  it("rejects empty message without a shared post", () => {
    const result = sendMessageSchema.safeParse({ recipientId: 2, body: "   " });
    expect(result.success).toBe(false);
  });
});
