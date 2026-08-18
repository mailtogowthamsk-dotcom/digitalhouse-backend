import { Op } from "sequelize";
import { AD_RANKING, isAdvertisementPlacement } from "../../constants/advertisement.constants";
import { Advertisement, AdvertisementUserExposure } from "../../models/Advertisement.models";
import { serializeDeliveryCard } from "./Advertisement.service";
import { selectRankedAdvertisement, type RankingCandidate } from "./AdvertisementRanking.service";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

const DELIVERY_ATTRIBUTES = [
  "id",
  "userId",
  "title",
  "description",
  "shortDescription",
  "ctaLabel",
  "ctaType",
  "mediaUrl",
  "thumbnailUrl",
  "mediaKind",
  "typeCode",
  "businessName",
  "businessCategory",
  "contactPhone",
  "whatsappNumber",
  "contactEmail",
  "websiteUrl",
  "destinationUrl",
  "address",
  "city",
  "district",
  "state",
  "pincode",
  "latitude",
  "longitude",
  "placementsJson",
  "targetingJson",
  "status",
  "scheduledStartAt",
  "scheduledEndAt",
  "lastDeliveredAt",
  "impressionsCount",
  "clicksCount",
  "reportsCount",
  "createdAt"
] as const;

function matchesPlacement(ad: Advertisement, placement: string): boolean {
  const placements = Array.isArray(ad.placementsJson) ? ad.placementsJson : ["home"];
  return placements.includes(placement);
}

function matchesTargeting(ad: Advertisement): boolean {
  const targeting = ad.targetingJson ?? { audience: "ALL" };
  return !targeting.audience || targeting.audience === "ALL";
}

/**
 * Ranked feed slot. One bounded candidate query + one exposure query, then in-memory scoring.
 * GET /feed is not an impression; lastDeliveredAt is only a fairness + grace-window signal.
 */
export async function getFeedAdvertisement(params: {
  userId: number;
  placement: string;
  excludeId?: number;
}) {
  const placement = params.placement || "home";
  if (!isAdvertisementPlacement(placement)) {
    throw httpError("Unsupported placement", 400, "INVALID_PLACEMENT");
  }
  const now = new Date();
  const candidates = await Advertisement.findAll({
    where: {
      status: "ACTIVE",
      userId: { [Op.ne]: params.userId },
      scheduledStartAt: { [Op.lte]: now },
      scheduledEndAt: { [Op.gt]: now }
    },
    order: [
      ["lastDeliveredAt", "ASC"],
      ["id", "ASC"]
    ],
    limit: AD_RANKING.CANDIDATE_POOL,
    attributes: [...DELIVERY_ATTRIBUTES]
  });

  const eligible = candidates.filter((ad) => matchesPlacement(ad, placement) && matchesTargeting(ad));
  if (!eligible.length) return { advertisement: null, placement };

  const ids = eligible.map((ad) => ad.id);
  const exposureRows = await AdvertisementUserExposure.findAll({
    where: { userId: params.userId, advertisementId: { [Op.in]: ids } },
    attributes: ["advertisementId", "lastImpressionAt", "impressionCount"]
  });
  const exposures = new Map(
    exposureRows.map((row) => [
      row.advertisementId,
      {
        advertisementId: row.advertisementId,
        lastImpressionAt: row.lastImpressionAt,
        impressionCount: row.impressionCount
      }
    ])
  );

  let excludeAdvertiserId: number | null = null;
  if (params.excludeId) {
    const fromPool = eligible.find((ad) => ad.id === params.excludeId);
    if (fromPool) excludeAdvertiserId = fromPool.userId;
    else {
      const previous = await Advertisement.findByPk(params.excludeId, { attributes: ["userId"] });
      excludeAdvertiserId = previous?.userId ?? null;
    }
  }

  const ranked = selectRankedAdvertisement(
    eligible.map(
      (ad): RankingCandidate => ({
        id: ad.id,
        userId: ad.userId,
        impressionsCount: ad.impressionsCount,
        clicksCount: ad.clicksCount,
        reportsCount: ad.reportsCount ?? 0,
        createdAt: ad.createdAt,
        lastDeliveredAt: ad.lastDeliveredAt
      })
    ),
    {
      now,
      excludeId: params.excludeId ?? null,
      excludeAdvertiserId,
      exposures
    }
  );

  const chosen = ranked ? eligible.find((ad) => ad.id === ranked.candidate.id) ?? null : null;
  if (!chosen) return { advertisement: null, placement };

  chosen.lastDeliveredAt = now;
  chosen.updatedAt = now;
  await chosen.save().catch(() => undefined);

  return {
    advertisement: serializeDeliveryCard(chosen),
    placement
  };
}
