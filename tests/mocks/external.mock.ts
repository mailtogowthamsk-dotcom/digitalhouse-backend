import { vi } from "vitest";

/**
 * External API mocks — Razorpay, Google Auth, SMTP, Expo/FCM push.
 * Use vi.mock on the service module paths that wrap these vendors.
 */

export function createRazorpayMock() {
  return {
    orders: {
      create: vi.fn(async (opts: { amount: number; currency: string; receipt?: string }) => ({
        id: "order_test_123",
        amount: opts.amount,
        currency: opts.currency,
        receipt: opts.receipt ?? null,
        status: "created"
      })),
      fetch: vi.fn(async (id: string) => ({
        id,
        amount: 10000,
        currency: "INR",
        status: "paid"
      }))
    },
    payments: {
      fetch: vi.fn(async (id: string) => ({
        id,
        order_id: "order_test_123",
        status: "captured",
        amount: 10000
      }))
    }
  };
}

export function createGoogleAuthMock() {
  return {
    verifyIdToken: vi.fn(async () => ({
      getPayload: () => ({
        sub: "google-user-test-1",
        email: "user@example.com",
        email_verified: true,
        name: "Test User",
        picture: "https://cdn.test.local/avatar.jpg"
      })
    }))
  };
}

export function createNodemailerMock() {
  const sendMail = vi.fn(async () => ({ messageId: "test-message-id" }));
  return {
    createTransport: vi.fn(() => ({ sendMail, verify: vi.fn(async () => true) })),
    __sendMail: sendMail
  };
}

export function createExpoPushMock() {
  return {
    sendPushNotificationsAsync: vi.fn(async (messages: unknown[]) =>
      (messages as unknown[]).map(() => ({ status: "ok", id: "expo-ticket-test" }))
    ),
    chunkPushNotifications: vi.fn((messages: unknown[]) => [messages])
  };
}

/**
 * Apply common vendor mocks. Call inside a test file (not setup) so mocks stay scoped.
 *
 * Example:
 *   mockExternalApis();
 *   const { mailService } = await import("../../src/services/mail.service");
 */
export function mockExternalApis() {
  const razorpay = createRazorpayMock();
  const google = createGoogleAuthMock();
  const mailer = createNodemailerMock();
  const expo = createExpoPushMock();

  vi.mock("razorpay", () => ({
    default: vi.fn(function Razorpay() {
      return razorpay;
    })
  }));

  vi.mock("google-auth-library", () => ({
    OAuth2Client: vi.fn(function OAuth2Client() {
      return google;
    })
  }));

  vi.mock("nodemailer", () => mailer);

  return { razorpay, google, mailer, expo };
}
