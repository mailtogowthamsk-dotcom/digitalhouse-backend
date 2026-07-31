import { vi } from "vitest";

/**
 * Cloudflare R2 mock — replaces src/utils/r2Client without hitting the network.
 *
 * Apply in a test file BEFORE importing code under test:
 *   vi.mock("../../src/utils/r2Client", () => createR2MockModule());
 */
export type R2MockApi = ReturnType<typeof createR2MockFns>;

export function createR2MockFns() {
  const cdn = process.env.R2_CDN_PUBLIC_URL || "https://cdn.test.local";

  return {
    getPresignedPutUrl: vi.fn(async (key: string) => `https://r2.test.local/put/${key}`),
    getPresignedGetUrl: vi.fn(async (key: string) => `https://r2.test.local/get/${key}?sig=test`),
    getCdnPublicUrl: vi.fn((key: string) => `${cdn}/${key.replace(/^\//, "")}`),
    toPublicUrlIfR2: vi.fn((url: string | null | undefined) => {
      if (!url) return null;
      if (url.startsWith("http")) return url;
      return `${cdn}/${url.replace(/^\//, "")}`;
    }),
    toStorageKeyIfR2: vi.fn((url: string | null | undefined) => {
      if (!url) return null;
      if (!url.startsWith("http")) return url;
      const idx = url.indexOf(".local/");
      if (idx >= 0) return url.slice(idx + ".local/".length);
      try {
        return new URL(url).pathname.replace(/^\//, "");
      } catch {
        return url;
      }
    }),
    isPrivateR2Object: vi.fn((url: string | null | undefined) =>
      Boolean(url && (url.includes("/private/") || url.includes("horoscope")))
    ),
    extractR2KeyFromUrl: vi.fn((u: string) => u.replace(/^https?:\/\/[^/]+\//, "")),
    normalizeR2ObjectKey: vi.fn((key: string) => key.replace(/^\//, "")),
    getR2ObjectBuffer: vi.fn(async () => Buffer.from("mock-object")),
    getR2ObjectMetadata: vi.fn(async () => ({ contentType: "image/jpeg", byteSize: 12 })),
    putR2ObjectBuffer: vi.fn(async () => undefined),
    deleteR2ObjectByKey: vi.fn(async () => undefined),
    deleteR2ImageVariants: vi.fn(async () => undefined),
    deleteMediaArtifacts: vi.fn(async () => undefined),
    deleteR2ObjectIfStored: vi.fn(async () => undefined),
    toSignedUrlIfR2: vi.fn(async (url: string | null | undefined) => url),
    toPrivateSignedUrlIfR2: vi.fn(async (url: string | null | undefined) =>
      url ? `https://r2.test.local/signed?k=${encodeURIComponent(url)}` : null
    )
  };
}

/** Factory suitable for vi.mock factory argument. */
export function createR2MockModule() {
  return createR2MockFns();
}
