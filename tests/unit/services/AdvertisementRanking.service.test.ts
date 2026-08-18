import { describe, expect, it } from "vitest";
import { AD_RANKING } from "../../../src/constants/advertisement.constants";
import {
  performanceScore,
  selectRankedAdvertisement,
  smoothedCtr,
  type RankingCandidate
} from "../../../src/services/advertisement/AdvertisementRanking.service";

function ad(partial: Partial<RankingCandidate> & Pick<RankingCandidate, "id">): RankingCandidate {
  return {
    userId: 10,
    impressionsCount: 0,
    clicksCount: 0,
    reportsCount: 0,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lastDeliveredAt: null,
    ...partial
  };
}

const now = new Date("2026-08-16T12:00:00.000Z");

describe("advertisement ranking", () => {
  it("does not let a 1/1 CTR outrank a mature campaign", () => {
    const tiny = performanceScore(1, 1);
    const mature = performanceScore(80, 2000);
    expect(tiny).toBeLessThan(mature);
    expect(smoothedCtr(1, 1)).toBeLessThan(0.05);
  });

  it("prefers an unseen ad over one the viewer just saw", () => {
    const chosen = selectRankedAdvertisement(
      [ad({ id: 1, impressionsCount: 400, clicksCount: 40 }), ad({ id: 2, impressionsCount: 400, clicksCount: 20 })],
      {
        now,
        excludeId: 1,
        exposures: new Map([
          [1, { advertisementId: 1, lastImpressionAt: now, impressionCount: 3 }]
        ]),
        rng: () => 0
      }
    );
    expect(chosen?.candidate.id).toBe(2);
  });

  it("gives a new campaign a freshness boost over an equally performing older one", () => {
    const chosen = selectRankedAdvertisement(
      [
        ad({
          id: 1,
          impressionsCount: 200,
          clicksCount: 8,
          createdAt: new Date("2026-01-01T00:00:00.000Z")
        }),
        ad({
          id: 2,
          impressionsCount: 200,
          clicksCount: 8,
          createdAt: now
        })
      ],
      { now, exposures: new Map(), rng: () => 0 }
    );
    expect(chosen?.candidate.id).toBe(2);
  });

  it("penalizes repeatedly reported campaigns", () => {
    const chosen = selectRankedAdvertisement(
      [
        ad({ id: 1, impressionsCount: 800, clicksCount: 40, reportsCount: 12 }),
        ad({ id: 2, impressionsCount: 800, clicksCount: 40, reportsCount: 0 })
      ],
      { now, exposures: new Map(), rng: () => 0 }
    );
    expect(chosen?.candidate.id).toBe(2);
  });

  it("relaxes cooldown when only one eligible campaign exists", () => {
    const chosen = selectRankedAdvertisement([ad({ id: 9, impressionsCount: 100, clicksCount: 4 })], {
      now,
      excludeId: 9,
      exposures: new Map([[9, { advertisementId: 9, lastImpressionAt: now, impressionCount: 6 }]]),
      rng: () => 0
    });
    expect(chosen?.candidate.id).toBe(9);
  });

  it("avoids repeating the same advertiser when another exists", () => {
    const chosen = selectRankedAdvertisement(
      [
        ad({ id: 1, userId: 44, impressionsCount: 300, clicksCount: 20 }),
        ad({ id: 2, userId: 88, impressionsCount: 300, clicksCount: 18 })
      ],
      {
        now,
        excludeAdvertiserId: 44,
        exposures: new Map(),
        rng: () => 0
      }
    );
    expect(chosen?.candidate.id).toBe(2);
  });

  it("keeps ranking weights centralized", () => {
    expect(AD_RANKING.CANDIDATE_POOL).toBeLessThanOrEqual(40);
    expect(AD_RANKING.PERFORMANCE_WEIGHT).toBeGreaterThan(AD_RANKING.FRESHNESS_WEIGHT);
  });
});
