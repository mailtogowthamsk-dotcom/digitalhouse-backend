import { AD_RANKING } from "../../constants/advertisement.constants";

export type RankingCandidate = {
  id: number;
  userId: number;
  impressionsCount: number;
  clicksCount: number;
  reportsCount: number;
  createdAt: Date | string;
  lastDeliveredAt: Date | string | null;
};

export type UserExposureSignal = {
  advertisementId: number;
  lastImpressionAt: Date | string | null;
  impressionCount: number;
};

export type RankContext = {
  now: Date;
  excludeId?: number | null;
  excludeAdvertiserId?: number | null;
  exposures: Map<number, UserExposureSignal>;
  rng?: () => number;
};

export type ScoredCandidate = {
  candidate: RankingCandidate;
  score: number;
  parts: {
    quality: number;
    performance: number;
    freshness: number;
    fairness: number;
    exposure: number;
    repeat: number;
    advertiser: number;
    report: number;
  };
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function asTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const t = typeof value === "string" ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(t) ? t : null;
}

/** Smoothed CTR so 1 impression / 1 click cannot dominate a mature campaign. */
export function smoothedCtr(clicks: number, impressions: number): number {
  const n = AD_RANKING.PRIOR_IMPRESSIONS;
  return (Math.max(0, clicks) + AD_RANKING.PRIOR_CTR * n) / (Math.max(0, impressions) + n);
}

export function performanceScore(clicks: number, impressions: number): number {
  return clamp(smoothedCtr(clicks, impressions) / AD_RANKING.CTR_SCORE_CAP, 0, 1);
}

export function freshnessScore(createdAt: Date | string, now: Date): number {
  const created = asTime(createdAt);
  if (created == null) return 0;
  const ageHours = Math.max(0, (now.getTime() - created) / 3_600_000);
  return Math.exp((-Math.LN2 * ageHours) / AD_RANKING.FRESHNESS_HALFLIFE_HOURS);
}

export function qualityScore(reportsCount: number): number {
  return 1 / (1 + Math.max(0, reportsCount) * 0.35);
}

export function fairnessScore(lastDeliveredAt: Date | string | null, now: Date): number {
  const last = asTime(lastDeliveredAt);
  if (last == null) return 1;
  const hours = Math.max(0, (now.getTime() - last) / 3_600_000);
  return clamp(hours / 24, 0, 1);
}

export function exposurePenalty(
  adId: number,
  exposure: UserExposureSignal | undefined,
  excludeId: number | null | undefined,
  now: Date
): number {
  if (excludeId && adId === excludeId) return 1;
  const last = asTime(exposure?.lastImpressionAt ?? null);
  if (last == null) return 0;
  const ago = now.getTime() - last;
  if (ago < AD_RANKING.COOLDOWN_MS) return 1;
  if (ago < AD_RANKING.SOFT_COOLDOWN_MS) return 0.45;
  return 0;
}

export function repeatPenalty(exposure: UserExposureSignal | undefined): number {
  return clamp((exposure?.impressionCount ?? 0) / 8, 0, 1);
}

export function advertiserPenalty(adUserId: number, excludeAdvertiserId: number | null | undefined): number {
  return excludeAdvertiserId && adUserId === excludeAdvertiserId ? 1 : 0;
}

export function reportPenalty(reportsCount: number, impressions: number): number {
  const rate = Math.max(0, reportsCount) / Math.max(impressions, AD_RANKING.PRIOR_IMPRESSIONS);
  return clamp(reportsCount * 0.12 + rate * 4, 0, 1);
}

export function scoreCandidate(ad: RankingCandidate, ctx: RankContext): ScoredCandidate {
  const exposure = ctx.exposures.get(ad.id);
  const parts = {
    quality: qualityScore(ad.reportsCount),
    performance: performanceScore(ad.clicksCount, ad.impressionsCount),
    freshness: freshnessScore(ad.createdAt, ctx.now),
    fairness: fairnessScore(ad.lastDeliveredAt, ctx.now),
    exposure: exposurePenalty(ad.id, exposure, ctx.excludeId, ctx.now),
    repeat: repeatPenalty(exposure),
    advertiser: advertiserPenalty(ad.userId, ctx.excludeAdvertiserId),
    report: reportPenalty(ad.reportsCount, ad.impressionsCount)
  };
  const score =
    AD_RANKING.QUALITY_WEIGHT * parts.quality +
    AD_RANKING.PERFORMANCE_WEIGHT * parts.performance +
    AD_RANKING.FRESHNESS_WEIGHT * parts.freshness +
    AD_RANKING.FAIRNESS_WEIGHT * parts.fairness -
    AD_RANKING.EXPOSURE_PENALTY_WEIGHT * parts.exposure -
    AD_RANKING.REPEAT_PENALTY_WEIGHT * parts.repeat -
    AD_RANKING.ADVERTISER_PENALTY_WEIGHT * parts.advertiser -
    AD_RANKING.REPORT_PENALTY_WEIGHT * parts.report;
  return { candidate: ad, score, parts };
}

function weightedPick(rows: ScoredCandidate[], rng: () => number): ScoredCandidate {
  if (rows.length === 1) return rows[0];
  const weights = rows.map((row) => Math.max(0.02, row.score + 0.08));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let cursor = rng() * total;
  for (let i = 0; i < rows.length; i += 1) {
    cursor -= weights[i];
    if (cursor <= 0) return rows[i];
  }
  return rows[rows.length - 1];
}

/**
 * Rank a bounded in-memory pool and pick one campaign.
 * Strict cooldown is relaxed when inventory is too small to fill the slot.
 */
export function selectRankedAdvertisement(
  candidates: RankingCandidate[],
  ctx: RankContext
): ScoredCandidate | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((ad) => scoreCandidate(ad, ctx))
    .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);

  const notJustSeen = scored.filter((row) => row.parts.exposure < 1);
  const pool =
    notJustSeen.length >= 1 && candidates.length >= AD_RANKING.MIN_INVENTORY_FOR_STRICT_COOLDOWN
      ? notJustSeen
      : scored;

  const top = pool.slice(0, AD_RANKING.TOP_K);
  return weightedPick(top, ctx.rng ?? Math.random);
}
