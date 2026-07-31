import { describe, it, expect, beforeEach } from "vitest";
import { createR2MockFns } from "../../mocks/r2.mock";
import { createRedisMock } from "../../mocks/redis.mock";
import { createRazorpayMock, createGoogleAuthMock, createNodemailerMock } from "../../mocks/external.mock";

describe("test mocks — R2", () => {
  it("builds public CDN URLs and storage keys without network I/O", async () => {
    const r2 = createR2MockFns();
    expect(r2.getCdnPublicUrl("digital-house/a.jpg")).toBe("https://cdn.test.local/digital-house/a.jpg");
    expect(await r2.getPresignedPutUrl("digital-house/a.jpg", "image/jpeg")).toContain("/put/");
    expect(r2.isPrivateR2Object("digital-house/private/x.pdf")).toBe(true);
    expect(r2.isPrivateR2Object("digital-house/posts/x.jpg")).toBe(false);
  });
});

describe("test mocks — Redis", () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("supports get/set/del for future presence and adapter work", async () => {
    expect(await redis.ping()).toBe("PONG");
    await redis.set("presence:1", "online");
    expect(await redis.get("presence:1")).toBe("online");
    await redis.del("presence:1");
    expect(await redis.get("presence:1")).toBeNull();
  });

  it("supports hash and set primitives used by Socket.io adapters", async () => {
    await redis.hset("sess:abc", "userId", "42");
    expect(await redis.hget("sess:abc", "userId")).toBe("42");
    await redis.sadd("room:feed", "sock-1", "sock-2");
    expect(await redis.smembers("room:feed")).toEqual(["sock-1", "sock-2"]);
  });
});

describe("test mocks — external APIs", () => {
  it("Razorpay mock returns a synthetic order", async () => {
    const rz = createRazorpayMock();
    const order = await rz.orders.create({ amount: 49900, currency: "INR", receipt: "m-1" });
    expect(order.id).toMatch(/^order_/);
    expect(order.amount).toBe(49900);
  });

  it("Google Auth mock returns a verified payload", async () => {
    const google = createGoogleAuthMock();
    const ticket = await google.verifyIdToken();
    expect(ticket.getPayload()?.email).toBe("user@example.com");
  });

  it("Nodemailer mock records sendMail calls", async () => {
    const mailer = createNodemailerMock();
    const transport = mailer.createTransport();
    await transport.sendMail({ to: "a@b.com", subject: "Hi" });
    expect(mailer.__sendMail).toHaveBeenCalledTimes(1);
  });
});
