import { AuthAnalyticsEvent } from "../models/AuthAnalyticsEvent.model";
import type { AuthAnalyticsEventType, AuthProviderCode } from "../constants/auth.constants";

export async function trackAuthEvent(
  eventType: AuthAnalyticsEventType,
  options?: {
    userId?: number | null;
    provider?: AuthProviderCode | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await AuthAnalyticsEvent.create({
      userId: options?.userId ?? null,
      eventType,
      provider: options?.provider ?? null,
      metadata: options?.metadata ?? null,
      createdAt: new Date()
    } as any);
  } catch (e) {
    console.warn("[authAnalytics] track failed", eventType, e);
  }
}

export async function getAuthAnalyticsSummary(): Promise<{
  googleSignups: number;
  googleLogins: number;
  existingLogins: number;
  googleLinked: number;
}> {
  const count = async (eventType: AuthAnalyticsEventType) =>
    AuthAnalyticsEvent.count({ where: { eventType } }).catch(() => 0);

  const [googleSignups, googleLogins, existingLogins, googleLinked] = await Promise.all([
    count("GOOGLE_SIGNUP"),
    count("GOOGLE_LOGIN"),
    count("EXISTING_LOGIN"),
    count("GOOGLE_LINKED")
  ]);

  return { googleSignups, googleLogins, existingLogins, googleLinked };
}
