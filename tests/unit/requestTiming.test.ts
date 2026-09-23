import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_METRICS_ROUTES,
  normalizeMetricRoute,
  parseApiMetricsRouteAllowlist,
  shouldEmitApiMetric
} from "../../src/utils/requestTiming";

describe("requestTiming normalizeMetricRoute", () => {
  it("strips query and /api mount", () => {
    expect(normalizeMetricRoute("/api/home/bootstrap?limit=6")).toBe("/home/bootstrap");
    expect(normalizeMetricRoute("/api/v1/auth/me")).toBe("/auth/me");
    expect(normalizeMetricRoute("/home/feed/")).toBe("/home/feed");
  });

  it("does not embed query secrets into route key", () => {
    const route = normalizeMetricRoute("/api/auth/me?token=supersecret");
    expect(route).toBe("/auth/me");
    expect(route).not.toContain("token");
  });
});

describe("requestTiming allowlist", () => {
  it("defaults to cold-start routes", () => {
    for (const r of DEFAULT_API_METRICS_ROUTES) {
      expect(shouldEmitApiMetric(r, null)).toBe(true);
    }
    expect(shouldEmitApiMetric("/admin/users", null)).toBe(false);
  });

  it("supports * and custom list", () => {
    expect(shouldEmitApiMetric("/anything", new Set(["*"]))).toBe(true);
    const custom = parseApiMetricsRouteAllowlist("/home/bootstrap,/auth/me");
    expect(shouldEmitApiMetric("/home/bootstrap", custom)).toBe(true);
    expect(shouldEmitApiMetric("/home/feed", custom)).toBe(false);
  });

  it("prefix-matches nested story routes when /stories listed", () => {
    expect(shouldEmitApiMetric("/stories/12", null)).toBe(true);
  });
});
