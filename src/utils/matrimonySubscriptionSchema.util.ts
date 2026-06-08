import type { FindOptions } from "sequelize";
import { MatrimonySubscription } from "../models";

/** Columns from phase-5 monetization migration only */
export const MATRIMONY_SUBSCRIPTION_BASE_ATTRIBUTES = [
  "id",
  "userId",
  "plan",
  "status",
  "durationMonths",
  "startsAt",
  "endsAt",
  "paymentRef",
  "createdAt",
  "updatedAt"
] as const;

let p1ColumnsReady: boolean | null = null;

export async function hasMatrimonySubscriptionP1Columns(): Promise<boolean> {
  if (p1ColumnsReady !== null) return p1ColumnsReady;
  try {
    await MatrimonySubscription.sequelize!.query(
      "SELECT amount_paise FROM matrimony_subscriptions LIMIT 1"
    );
    p1ColumnsReady = true;
  } catch {
    p1ColumnsReady = false;
  }
  return p1ColumnsReady;
}

/** Avoid SELECT on columns that do not exist until P1 migration is applied. */
export async function withSubscriptionAttributes(
  options: FindOptions = {}
): Promise<FindOptions> {
  if (await hasMatrimonySubscriptionP1Columns()) return options;
  return {
    ...options,
    attributes: [...MATRIMONY_SUBSCRIPTION_BASE_ATTRIBUTES]
  };
}

export async function subscriptionCreatePayload(
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (await hasMatrimonySubscriptionP1Columns()) return data;
  const allowed = new Set<string>(MATRIMONY_SUBSCRIPTION_BASE_ATTRIBUTES);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}
