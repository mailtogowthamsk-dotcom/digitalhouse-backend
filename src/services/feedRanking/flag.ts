import { PlatformFeatureFlag } from "../../models";
import { PERSONALIZED_FEED_FLAG } from "./config";
import { isPersonalizedHomeRequest } from "./requestGate";
import { getCurrentRequestId } from "../../utils/requestContext";

export { isPersonalizedHomeRequest };

let cache: { value: boolean; at: number } | null = null;
const TTL_MS = 15_000;

function envOverride(): boolean | null {
  const raw = (process.env.PERSONALIZED_FEED_ENABLED || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return null;
}

/** Env wins (emergency rollback). Else platform_feature_flags.personalized_feed (default off). */
export async function isPersonalizedFeedEnabled(): Promise<boolean> {
  const env = envOverride();
  if (env != null) return env;
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const row = await PlatformFeatureFlag.findOne({
      where: { code: PERSONALIZED_FEED_FLAG },
      attributes: ["enabled"]
    });
    cache = { value: Boolean(row?.enabled), at: now };
  } catch {
    cache = { value: false, at: now };
  }
  return cache.value;
}

export function logFeedMetrics(payload: Record<string, unknown>): void {
  if (process.env.FEED_METRICS !== "1") return;
  try {
    const requestId = getCurrentRequestId();
    console.info(
      "[feed-metrics]",
      JSON.stringify(requestId ? { requestId, ...payload } : payload)
    );
  } catch {
    /* ignore */
  }
}
