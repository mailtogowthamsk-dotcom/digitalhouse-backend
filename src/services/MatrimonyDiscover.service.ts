import { Op } from "sequelize";
import {
  User,
  UserProfile,
  MatrimonyInterest,
  MatrimonyMatch,
  MatrimonyProfileOpen
} from "../models";
import type { MatrimonySection } from "../models/UserProfile.model";
import { getMatrimonyHub, matrimonyBrowseBlockedMessage } from "./Matrimony.service";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { resolveCandidatePhotoUrl } from "../constants/matrimony-photo.constants";
import * as NotificationService from "./Notification.service";
import * as MatrimonySafety from "./MatrimonySafety.service";
import {
  calcAgeFromDob,
  kulamCompatibilityLabel,
  normalizeMatchPair,
  resolveMatrimonyCandidate,
  type MatrimonyCandidatePublic
} from "../utils/matrimonyCandidate.util";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { Location } from "../models";
import { computeMatrimonyMatchScore, starLabel } from "../utils/matrimonyMatchScore.util";
import * as Monetization from "./MatrimonyMonetization.service";

const MATRIMONY_DECLINE_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;
import type { MatrimonyStarLevel } from "../constants/matrimony-monetization.constants";

export type DiscoverCardDto = {
  userId: number;
  name: string;
  age: number | null;
  district: string | null;
  occupation: string | null;
  education: string | null;
  kulamLabel: string | null;
  photoUrl: string | null;
  /** True when photo is intentionally withheld (locked card). */
  photoPlaceholder: boolean;
  familyManaged: boolean;
  horoscopeAvailable: boolean;
  verified: boolean;
  interestSent: boolean;
  interestReceived: boolean;
  starLevel: MatrimonyStarLevel;
  starLabel: string;
  matchTags: string[];
  profileOpened: boolean;
  canOpen: boolean;
  openRequiresPlan: "GOLD" | "PLATINUM" | null;
  photoBlurred: boolean;
};

export type DiscoverDetailDto = MatrimonyCandidatePublic & {
  photoUrl: string | null;
  rashi: string | null;
  nakshatram: string | null;
  maritalStatus: string | null;
  dosham: string | null;
  kulamLabel: string | null;
  interestStatus: "NONE" | "SENT_PENDING" | "SENT_ACCEPTED" | "RECEIVED_PENDING" | "MATCHED";
  canSendInterest: boolean;
  canRespondInterest: boolean;
  pendingInterestId: number | null;
  mutualMatch: boolean;
  chatEnabled: boolean;
  contactVisible: boolean;
  horoscopeVisible: boolean;
  saved: boolean;
  blocked: boolean;
  starLevel?: MatrimonyStarLevel;
  starLabel?: string;
  matchTags?: string[];
  profileOpened?: boolean;
  contactPaymentStatus?: "NONE" | "PENDING" | "PAID";
};

function assertCanBrowse(hub: Awaited<ReturnType<typeof getMatrimonyHub>>): void {
  if (!hub.can_browse) {
    const err = new Error(matrimonyBrowseBlockedMessage(hub));
    (err as any).status = 403;
    (err as any).code = "MATRIMONY_BROWSE_LOCKED";
    throw err;
  }
}

export function isDiscoverableMatrimony(m: MatrimonySection | null): boolean {
  if (!m || m.matrimonyProfileActive !== true) return false;
  if (m.matrimonySuspended === true) return false;
  const photo = resolveCandidatePhotoUrl(m as Record<string, unknown>);
  if (!photo) return false;
  if (m.candidatePhotoStatus === "REJECTED" || m.candidatePhotoStatus === "REUPLOAD_REQUESTED") {
    return false;
  }
  return true;
}

function viewerKulam(viewerProfile: UserProfile | null, viewerUser: User): string | null {
  const community = normalizeJsonColumn(viewerProfile?.community, SECTION_ALLOWED_KEYS.community) as {
    kulam?: string;
  } | null;
  const m = normalizeJsonColumn(viewerProfile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection | null;
  return m?.kulamSnapshot ?? community?.kulam ?? viewerUser.kulam ?? null;
}

function passesGenderPreference(
  viewerM: MatrimonySection,
  candidate: MatrimonyCandidatePublic
): boolean {
  const pref = viewerM.partnerGenderPreference;
  if (!pref || !candidate.gender) return true;
  return candidate.gender.toUpperCase() === pref.toUpperCase();
}

function passesAgePreference(viewerM: MatrimonySection, candidateAge: number | null): boolean {
  if (candidateAge == null) return true;
  const min = viewerM.partnerAgeMin;
  const max = viewerM.partnerAgeMax;
  if (min != null && candidateAge < min) return false;
  if (max != null && candidateAge > max) return false;
  return true;
}

function passesDistrictPreference(
  viewerM: MatrimonySection,
  candidateDistrict: string | null,
  locationNames: Map<number, string>
): boolean {
  const ids = viewerM.preferredDistrictIds;
  if (!ids?.length || !candidateDistrict) return true;
  const names = ids.map((id) => locationNames.get(id)?.toLowerCase()).filter(Boolean);
  // Stale or invalid location IDs must not hide every profile.
  if (names.length === 0) return true;
  return names.some((n) => candidateDistrict.toLowerCase().includes(n!));
}

type DiscoverEmptyStats = {
  candidates: number;
  notDiscoverable: number;
  sameKulam: number;
  gender: number;
  age: number;
  district: number;
  browseFilters: number;
};

function buildDiscoverEmptyHint(stats: DiscoverEmptyStats, viewerK: string | null): string {
  const ranked: { count: number; message: string }[] = [
    {
      count: stats.sameKulam,
      message:
        "All visible profiles share your kulam (same kulam is hidden). Profiles from other kulams will appear when they join."
    },
    {
      count: stats.gender,
      message:
        "No profiles match your partner gender preference. Edit Matrimony setup and check “Partner gender”."
    },
    {
      count: stats.age,
      message:
        "No profiles match your partner age range (21–35 by default). Widen min/max age in Matrimony setup."
    },
    {
      count: stats.district,
      message:
        "No profiles are in your preferred districts. Clear or update preferred districts in Matrimony setup."
    },
    {
      count: stats.browseFilters,
      message: 'No profiles match the browse filters you applied. Tap "All" and clear extra filters.'
    },
    {
      count: stats.notDiscoverable,
      message: "No other members have an active matrimony profile with an approved photo yet."
    }
  ];
  ranked.sort((a, b) => b.count - a.count);
  const top = ranked.find((r) => r.count > 0);
  if (top) return top.message;
  if (!viewerK?.trim()) {
    return "Add your kulam in community/matrimony setup so compatible profiles can be matched.";
  }
  return "No profiles to show right now. Pull to refresh or try again later.";
}

async function loadLocationMap(): Promise<Map<number, string>> {
  const rows = await Location.findAll({ attributes: ["id", "name"] });
  return new Map(rows.map((l) => [l.id, l.name]));
}

export async function getActiveMatrimonyMatch(
  userId: number,
  otherUserId: number
): Promise<MatrimonyMatch | null> {
  const { low, high } = normalizeMatchPair(userId, otherUserId);
  try {
    return await MatrimonyMatch.findOne({
      where: { userLowId: low, userHighId: high, status: "ACTIVE" }
    });
  } catch {
    return null;
  }
}

async function tryCreateMutualMatch(userA: number, userB: number): Promise<MatrimonyMatch | null> {
  try {
    const ab = await MatrimonyInterest.findOne({
      where: { fromUserId: userA, toUserId: userB, status: "ACCEPTED" }
    });
    const ba = await MatrimonyInterest.findOne({
      where: { fromUserId: userB, toUserId: userA, status: "ACCEPTED" }
    });
    if (!ab || !ba) return null;

    const { low, high } = normalizeMatchPair(userA, userB);
    const [match] = await MatrimonyMatch.findOrCreate({
      where: { userLowId: low, userHighId: high },
      defaults: {
        userLowId: low,
        userHighId: high,
        status: "ACTIVE",
        chatEnabled: true,
        contactRevealed: false,
        horoscopeShared: false,
        matchedAt: new Date()
      } as any
    });
    if (match.status !== "ACTIVE") {
      await match.update({ status: "ACTIVE", matchedAt: new Date() } as any);
    }
    return match;
  } catch (err) {
    console.warn("[MatrimonyDiscover] match create skipped — run matrimony-phase2.sql", err);
    return null;
  }
}

export async function discoverProfiles(
  viewerId: number,
  opts: {
    page?: number;
    limit?: number;
    district?: string;
    ageMin?: number;
    ageMax?: number;
    horoscopeOnly?: boolean;
  }
): Promise<{
  items: DiscoverCardDto[];
  total: number;
  page: number;
  limit: number;
  emptyHint?: string;
}> {
  const hub = await getMatrimonyHub(viewerId);
  assertCanBrowse(hub);

  const viewer = await User.findByPk(viewerId);
  const viewerProfile = await UserProfile.findOne({ where: { userId: viewerId } });
  if (!viewer) throw Object.assign(new Error("User not found"), { status: 404 });

  const viewerM = normalizeJsonColumn(
    viewerProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection | null;
  if (!viewerM) throw Object.assign(new Error("Matrimony profile required"), { status: 403 });

  const viewerK = viewerKulam(viewerProfile, viewer);
  const viewerCandidate = resolveMatrimonyCandidate(viewer, viewerM);
  const viewerAge = viewerCandidate.age;

  const locationMap = await loadLocationMap();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

  const rows = await UserProfile.findAll({
    attributes: ["userId", "matrimony"],
    include: [
      {
        model: User,
        required: true,
        attributes: ["id", "fullName", "dob", "district", "gender", "kulam", "profilePhoto", "status"],
        where: { status: "APPROVED", id: { [Op.ne]: viewerId } }
      }
    ],
    limit: 500
  });

  let interests: MatrimonyInterest[] = [];
  let matches: MatrimonyMatch[] = [];
  try {
    [interests, matches] = await Promise.all([
      MatrimonyInterest.findAll({
        where: {
          [Op.or]: [{ fromUserId: viewerId }, { toUserId: viewerId }]
        }
      }),
      MatrimonyMatch.findAll({
        where: {
          status: "ACTIVE",
          [Op.or]: [{ userLowId: viewerId }, { userHighId: viewerId }]
        }
      })
    ]);
  } catch {
    /* tables may not exist yet */
  }

  const matchedUserIds = new Set<number>();
  for (const m of matches) {
    matchedUserIds.add(m.userLowId === viewerId ? m.userHighId : m.userLowId);
  }

  const interestByOther = new Map<number, { sent: boolean; received: boolean }>();
  for (const i of interests) {
    const other = i.fromUserId === viewerId ? i.toUserId : i.fromUserId;
    const cur = interestByOther.get(other) ?? { sent: false, received: false };
    if (i.fromUserId === viewerId) cur.sent = true;
    else cur.received = true;
    interestByOther.set(other, cur);
  }

  const cards: DiscoverCardDto[] = [];
  const emptyStats: DiscoverEmptyStats = {
    candidates: 0,
    notDiscoverable: 0,
    sameKulam: 0,
    gender: 0,
    age: 0,
    district: 0,
    browseFilters: 0
  };
  const blockedIds = await MatrimonySafety.getBlockedUserIds(viewerId);
  const viewerPlan = await Monetization.getActivePlan(viewerId);
  const billingPeriod = Monetization.currentBillingPeriod();
  const openRows = await Monetization.ensureMonetizationTables()
    ? await MatrimonyProfileOpen.findAll({
        where: { userId: viewerId, billingPeriod },
        attributes: ["candidateUserId"]
      }).catch(() => [])
    : [];
  const openedSet = new Set(openRows.map((r) => r.candidateUserId));

  const matchRows = await MatrimonyMatch.findAll({
    where: {
      status: "ACTIVE",
      [Op.or]: [{ userLowId: viewerId }, { userHighId: viewerId }]
    },
    attributes: ["userLowId", "userHighId"]
  });
  const mutualSet = new Set<number>();
  for (const m of matchRows) {
    mutualSet.add(m.userLowId === viewerId ? m.userHighId : m.userLowId);
  }

  for (const row of rows) {
    const user = (row as any).User as User;
    if (blockedIds.has(user.id)) continue;
    const m = normalizeJsonColumn(row.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection | null;
    if (!isDiscoverableMatrimony(m)) {
      emptyStats.notDiscoverable++;
      continue;
    }

    const candidate = resolveMatrimonyCandidate(user, m!);
    const candidateKulam = candidate.kulam;
    emptyStats.candidates++;

    if (viewerK && candidateKulam && viewerK.trim().toLowerCase() === candidateKulam.trim().toLowerCase()) {
      emptyStats.sameKulam++;
      continue;
    }

    if (!passesGenderPreference(viewerM, candidate)) {
      emptyStats.gender++;
      continue;
    }
    if (!passesAgePreference(viewerM, candidate.age)) {
      emptyStats.age++;
      continue;
    }
    if (!passesDistrictPreference(viewerM, candidate.district, locationMap)) {
      emptyStats.district++;
      continue;
    }

    let failedBrowseFilter = false;
    if (opts.district?.trim()) {
      const needle = opts.district.trim().toLowerCase();
      const hay = (candidate.district ?? "").toLowerCase();
      if (!hay.includes(needle)) failedBrowseFilter = true;
    }
    if (!failedBrowseFilter && opts.ageMin != null && candidate.age != null && candidate.age < opts.ageMin) {
      failedBrowseFilter = true;
    }
    if (!failedBrowseFilter && opts.ageMax != null && candidate.age != null && candidate.age > opts.ageMax) {
      failedBrowseFilter = true;
    }
    if (!failedBrowseFilter && opts.horoscopeOnly && !candidate.horoscopeAvailable) {
      failedBrowseFilter = true;
    }
    if (failedBrowseFilter) {
      emptyStats.browseFilters++;
      continue;
    }

    const compat = kulamCompatibilityLabel(viewerK, candidateKulam);
    const int = interestByOther.get(user.id);
    const kulamLabel =
      compat === "Compatible"
        ? "Compatible kulam"
        : compat === "Different kulam"
          ? candidateKulam
          : candidateKulam;

    const matchScore = computeMatrimonyMatchScore({
      viewerDistrict: viewerCandidate.district,
      viewerAge,
      viewerM,
      candidateM: m!,
      candidate: {
        age: candidate.age,
        district: candidate.district,
        horoscopeAvailable: candidate.horoscopeAvailable,
        verified: candidate.verified,
        kulamLabel,
        education: candidate.education,
        occupation: candidate.occupation
      }
    });

    const mutualMatch = mutualSet.has(user.id);
    const profileOpened = mutualMatch || openedSet.has(user.id);
    const photoBlurred = !profileOpened;
    let photoUrl: string | null = null;
    if (!photoBlurred) {
      const photoRaw = resolveCandidatePhotoUrl(m as Record<string, unknown>);
      photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;
    }
    const gate = Monetization.resolveOpenGate(
      viewerPlan,
      matchScore.starLevel,
      profileOpened,
      mutualMatch
    );

    cards.push({
      userId: user.id,
      name: candidate.name,
      age: candidate.age,
      district: candidate.district,
      occupation: candidate.occupation,
      education: candidate.education,
      kulamLabel,
      photoUrl,
      familyManaged: candidate.familyManaged,
      horoscopeAvailable: candidate.horoscopeAvailable,
      verified: candidate.verified,
      interestSent: !!int?.sent,
      interestReceived: !!int?.received,
      starLevel: matchScore.starLevel,
      starLabel: starLabel(matchScore.starLevel),
      matchTags: matchScore.matchTags,
      profileOpened,
      canOpen: gate.canOpen && !profileOpened,
      openRequiresPlan: gate.openRequiresPlan,
      photoBlurred,
      photoPlaceholder: photoBlurred
    });
  }

  cards.sort((a, b) => b.starLevel - a.starLevel || (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

  const total = cards.length;
  const offset = (page - 1) * limit;
  const pageItems = cards.slice(offset, offset + limit);

  const result: {
    items: DiscoverCardDto[];
    total: number;
    page: number;
    limit: number;
    emptyHint?: string;
  } = { items: pageItems, total, page, limit };
  if (total === 0) {
    result.emptyHint = buildDiscoverEmptyHint(emptyStats, viewerK);
  }
  return result;
}

async function candidateHasFullAccess(
  viewerId: number,
  candidateUserId: number
): Promise<boolean> {
  const match = await getActiveMatrimonyMatch(viewerId, candidateUserId);
  if (match) return true;
  const Entitlement = await import("./MatrimonyEntitlement.service");
  return Entitlement.viewerHasProfileUnlock(viewerId, candidateUserId, false);
}

/** Validates candidate is approved, active, and discoverable before interest/save actions. */
export async function assertEligibleMatrimonyCandidate(
  viewerId: number,
  candidateUserId: number
): Promise<void> {
  if (candidateUserId === viewerId) {
    throw Object.assign(new Error("Invalid profile"), { status: 400 });
  }
  await MatrimonySafety.assertNotBlocked(viewerId, candidateUserId);

  const existingMatch = await getActiveMatrimonyMatch(viewerId, candidateUserId);
  if (existingMatch) {
    throw Object.assign(new Error("You are already matched with this profile."), {
      status: 400,
      code: "ALREADY_MATCHED"
    });
  }

  const candidateUser = await User.findOne({
    where: { id: candidateUserId, status: "APPROVED" }
  });
  if (!candidateUser) {
    throw Object.assign(new Error("Profile not found"), { status: 404 });
  }
  const candidateProfile = await UserProfile.findOne({ where: { userId: candidateUserId } });
  const m = normalizeJsonColumn(
    candidateProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection | null;
  if (!isDiscoverableMatrimony(m)) {
    throw Object.assign(new Error("Matrimony profile not available"), { status: 404 });
  }
}

export async function openCandidateProfile(
  viewerId: number,
  candidateUserId: number
): Promise<DiscoverDetailDto> {
  const hub = await getMatrimonyHub(viewerId);
  assertCanBrowse(hub);
  if (candidateUserId === viewerId) {
    throw Object.assign(new Error("Cannot view your own matrimony card"), { status: 400 });
  }
  await MatrimonySafety.assertNotBlocked(viewerId, candidateUserId);

  const [viewer, candidateUser, candidateProfile, viewerProfile] = await Promise.all([
    User.findByPk(viewerId),
    User.findOne({ where: { id: candidateUserId, status: "APPROVED" } }),
    UserProfile.findOne({ where: { userId: candidateUserId } }),
    UserProfile.findOne({ where: { userId: viewerId } })
  ]);
  if (!candidateUser) throw Object.assign(new Error("Profile not found"), { status: 404 });

  const m = normalizeJsonColumn(
    candidateProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection | null;
  const theyViewedMe = await Monetization.viewedProfileRecently(
    candidateUserId,
    viewerId
  );
  if (!m || (!isDiscoverableMatrimony(m) && !theyViewedMe)) {
    throw Object.assign(new Error("Matrimony profile not available"), { status: 404 });
  }

  const viewerM = normalizeJsonColumn(
    viewerProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection;
  const viewerCandidate = resolveMatrimonyCandidate(viewer!, viewerM);
  const candidate = resolveMatrimonyCandidate(candidateUser, m!);
  const viewerAge = calcAgeFromDob(viewer?.dob ?? null);
  const viewerK = viewerKulam(viewerProfile, viewer!);
  const kulamLabel = kulamCompatibilityLabel(viewerK, candidate.kulam);

  if (
    !theyViewedMe &&
    viewerK &&
    candidate.kulam &&
    viewerK.trim().toLowerCase() === candidate.kulam.trim().toLowerCase()
  ) {
    throw Object.assign(new Error("Profile not available"), { status: 404 });
  }

  const matchScore = computeMatrimonyMatchScore({
    viewerDistrict: viewerCandidate.district,
    viewerAge,
    viewerM,
    candidateM: m!,
    candidate: {
      age: candidate.age,
      district: candidate.district,
      horoscopeAvailable: candidate.horoscopeAvailable,
      verified: candidate.verified,
      kulamLabel,
      education: candidate.education,
      occupation: candidate.occupation
    }
  });

  const activeMatch = await getActiveMatrimonyMatch(viewerId, candidateUserId);
  if (!activeMatch) {
    await Monetization.assertCanOpenProfile(viewerId, candidateUserId, matchScore.starLevel);
    await Monetization.recordProfileOpen(viewerId, candidateUserId);
  }
  return getCandidateDetail(viewerId, candidateUserId);
}

export async function getCandidateDetail(
  viewerId: number,
  candidateUserId: number
): Promise<DiscoverDetailDto> {
  const hub = await getMatrimonyHub(viewerId);
  assertCanBrowse(hub);

  if (candidateUserId === viewerId) {
    throw Object.assign(new Error("Cannot view your own matrimony card"), { status: 400 });
  }

  await MatrimonySafety.assertNotBlocked(viewerId, candidateUserId);

  const [viewer, candidateUser, candidateProfile, viewerProfile] = await Promise.all([
    User.findByPk(viewerId),
    User.findOne({ where: { id: candidateUserId, status: "APPROVED" } }),
    UserProfile.findOne({ where: { userId: candidateUserId } }),
    UserProfile.findOne({ where: { userId: viewerId } })
  ]);

  if (!candidateUser || candidateUser.status !== "APPROVED") {
    throw Object.assign(new Error("Profile not found"), { status: 404 });
  }

  const m = normalizeJsonColumn(
    candidateProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection | null;
  const theyViewedMe = await Monetization.viewedProfileRecently(
    candidateUserId,
    viewerId
  );
  if (!m || (!isDiscoverableMatrimony(m) && !theyViewedMe)) {
    throw Object.assign(new Error("Matrimony profile not available"), { status: 404 });
  }

  const viewerM = normalizeJsonColumn(
    viewerProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection;
  const viewerK = viewerKulam(viewerProfile, viewer!);
  const candidate = resolveMatrimonyCandidate(candidateUser, m!);

  if (
    !theyViewedMe &&
    viewerK &&
    candidate.kulam &&
    viewerK.trim().toLowerCase() === candidate.kulam.trim().toLowerCase()
  ) {
    throw Object.assign(new Error("Profile not available"), { status: 404 });
  }

  const photoRaw = resolveCandidatePhotoUrl(m as Record<string, unknown>);
  const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;

  const match = await getActiveMatrimonyMatch(viewerId, candidateUserId);

  let sentInterest: MatrimonyInterest | null = null;
  let recvInterest: MatrimonyInterest | null = null;
  try {
    sentInterest = await MatrimonyInterest.findOne({
      where: { fromUserId: viewerId, toUserId: candidateUserId }
    });
    recvInterest = await MatrimonyInterest.findOne({
      where: { fromUserId: candidateUserId, toUserId: viewerId }
    });
  } catch {
    /* */
  }

  let interestStatus: DiscoverDetailDto["interestStatus"] = "NONE";
  if (match) interestStatus = "MATCHED";
  else if (sentInterest?.status === "ACCEPTED") interestStatus = "SENT_ACCEPTED";
  else if (sentInterest?.status === "PENDING") interestStatus = "SENT_PENDING";
  else if (recvInterest?.status === "PENDING") interestStatus = "RECEIVED_PENDING";

  const mutualMatch = !!match;
  const horoscopeVisible = mutualMatch && !!match?.horoscopeShared;
  const safetyFlags = await MatrimonySafety.getCandidateSafetyFlags(viewerId, candidateUserId);
  const viewerCandidate = resolveMatrimonyCandidate(viewer!, viewerM);
  const viewerAge = calcAgeFromDob(viewer?.dob ?? null);
  const kulamLabel = kulamCompatibilityLabel(viewerK, candidate.kulam);
  const matchScore = computeMatrimonyMatchScore({
    viewerDistrict: viewerCandidate.district,
    viewerAge,
    viewerM,
    candidateM: m!,
    candidate: {
      age: candidate.age,
      district: candidate.district,
      horoscopeAvailable: candidate.horoscopeAvailable,
      verified: candidate.verified,
      kulamLabel,
      education: candidate.education,
      occupation: candidate.occupation
    }
  });

  const fullAccess =
    theyViewedMe || (await candidateHasFullAccess(viewerId, candidateUserId));
  if (!fullAccess) {
    const plan = await Monetization.getActivePlan(viewerId);
    const gate = Monetization.resolveOpenGate(plan, matchScore.starLevel, false, false);
    throw Object.assign(new Error(gate.gateReason ?? "Profile locked"), {
      status: 403,
      code: "PROFILE_LOCKED",
      teaser: {
        userId: candidateUserId,
        name: candidate.name,
        age: candidate.age,
        district: candidate.district,
        occupation: candidate.occupation,
        starLevel: matchScore.starLevel,
        starLabel: starLabel(matchScore.starLevel),
        matchTags: matchScore.matchTags,
        openRequiresPlan: gate.openRequiresPlan,
        canOpen: gate.canOpen
      }
    });
  }

  await Monetization.recordProfileView(viewerId, candidateUserId);
  const contactPay = await Monetization.getContactRevealStatus(viewerId, candidateUserId);
  const contactVisible =
    mutualMatch && (match?.contactRevealed || contactPay.status === "PAID");

  return {
    ...candidate,
    photoUrl,
    rashi: m!.rashi ?? null,
    nakshatram: m!.nakshatram ?? null,
    maritalStatus: m!.maritalStatus ?? null,
    dosham: m!.dosham ?? null,
    kulamLabel,
    interestStatus,
    canSendInterest: (() => {
      if (mutualMatch) return false;
      if (!sentInterest || sentInterest.status === "WITHDRAWN") return true;
      if (sentInterest.status === "DECLINED") {
        const elapsed = Date.now() - (sentInterest.respondedAt?.getTime() ?? 0);
        return elapsed >= MATRIMONY_DECLINE_COOLDOWN_MS;
      }
      return false;
    })(),
    canRespondInterest: recvInterest?.status === "PENDING",
    pendingInterestId: recvInterest?.status === "PENDING" ? recvInterest.id : null,
    mutualMatch,
    chatEnabled: mutualMatch && (match?.chatEnabled ?? false),
    contactVisible,
    horoscopeVisible,
    saved: safetyFlags.saved,
    blocked: safetyFlags.blocked,
    starLevel: matchScore.starLevel,
    starLabel: starLabel(matchScore.starLevel),
    matchTags: matchScore.matchTags,
    profileOpened: true,
    contactPaymentStatus: contactPay.status
  };
}

export async function sendInterest(
  fromUserId: number,
  toUserId: number,
  introMessage?: string
): Promise<{
  interest: {
    id: number;
    fromUserId: number;
    toUserId: number;
    status: string;
    introMessage: string | null;
    createdAt: string;
    respondedAt: string | null;
  };
  mutualMatch: boolean;
}> {
  const hub = await getMatrimonyHub(fromUserId);
  assertCanBrowse(hub);

  await assertEligibleMatrimonyCandidate(fromUserId, toUserId);

  const existing = await MatrimonyInterest.findOne({
    where: { fromUserId, toUserId }
  });
  if (existing?.status === "PENDING") {
    throw Object.assign(new Error("Interest already sent"), { status: 400 });
  }
  if (existing?.status === "ACCEPTED") {
    throw Object.assign(new Error("Interest already accepted"), { status: 400 });
  }
  if (existing?.status === "DECLINED") {
    const elapsed = Date.now() - (existing.respondedAt?.getTime() ?? 0);
    if (elapsed < MATRIMONY_DECLINE_COOLDOWN_MS) {
      throw Object.assign(
        new Error("Please wait 60 days after a declined interest before sending again."),
        { status: 403, code: "MATRIMONY_DECLINE_COOLDOWN" }
      );
    }
  }

  let interest: MatrimonyInterest;
  if (existing) {
    await existing.update({
      status: "PENDING",
      introMessage: introMessage?.trim() || null,
      respondedAt: null
    } as any);
    interest = existing;
  } else {
    interest = await MatrimonyInterest.create({
      fromUserId,
      toUserId,
      status: "PENDING",
      introMessage: introMessage?.trim() || null
    } as any);
  }

  const match = await tryCreateMutualMatch(fromUserId, toUserId);
  void NotificationService.notifyMatrimonyInterestReceived(toUserId, fromUserId).catch(() => {});
  if (match) {
    void NotificationService.notifyMatrimonyMatch(fromUserId, toUserId).catch(() => {});
    void NotificationService.notifyMatrimonyMatch(toUserId, fromUserId).catch(() => {});
  }
  return {
    interest: {
      id: interest.id,
      fromUserId: interest.fromUserId,
      toUserId: interest.toUserId,
      status: interest.status,
      introMessage: interest.introMessage,
      createdAt: (interest.createdAt ?? new Date()).toISOString(),
      respondedAt: interest.respondedAt ? interest.respondedAt.toISOString() : null
    },
    mutualMatch: !!match
  };
}

export async function respondToInterest(
  userId: number,
  interestId: number,
  action: "ACCEPT" | "DECLINE",
  introMessage?: string
): Promise<{ interest: MatrimonyInterest; mutualMatch: boolean; match: MatrimonyMatch | null }> {
  const hub = await getMatrimonyHub(userId);
  assertCanBrowse(hub);

  const interest = await MatrimonyInterest.findByPk(interestId);
  if (!interest || interest.toUserId !== userId) {
    throw Object.assign(new Error("Interest not found"), { status: 404 });
  }
  if (interest.status !== "PENDING") {
    throw Object.assign(new Error("Interest already responded"), { status: 400 });
  }

  await interest.update({
    status: action === "ACCEPT" ? "ACCEPTED" : "DECLINED",
    respondedAt: new Date()
  } as any);

  const match =
    action === "ACCEPT"
      ? await tryCreateMutualMatch(interest.fromUserId, interest.toUserId)
      : null;

  if (action === "ACCEPT") {
    void NotificationService.notifyMatrimonyInterestAccepted(
      interest.fromUserId,
      interest.toUserId,
      introMessage?.trim() || undefined
    ).catch(() => {});
    if (match) {
      void NotificationService.notifyMatrimonyMatch(interest.fromUserId, interest.toUserId).catch(
        () => {}
      );
      void NotificationService.notifyMatrimonyMatch(interest.toUserId, interest.fromUserId).catch(
        () => {}
      );
    }
  } else {
    await closeMatrimonyMatchBetween(interest.fromUserId, interest.toUserId);
    void NotificationService.notifyMatrimonyInterestDeclined(
      interest.fromUserId,
      interest.toUserId
    ).catch(() => {});
  }

  return { interest, mutualMatch: !!match, match };
}

export async function withdrawInterest(
  fromUserId: number,
  interestId: number
): Promise<MatrimonyInterest> {
  const interest = await MatrimonyInterest.findByPk(interestId);
  if (!interest || interest.fromUserId !== fromUserId) {
    throw Object.assign(new Error("Interest not found"), { status: 404 });
  }
  if (interest.status === "PENDING") {
    await interest.update({ status: "WITHDRAWN", respondedAt: new Date() } as any);
    return interest;
  }
  if (interest.status === "ACCEPTED") {
    await interest.update({ status: "WITHDRAWN", respondedAt: new Date() } as any);
    const otherId = interest.toUserId;
    await closeMatrimonyMatchBetween(fromUserId, otherId);
    const reverse = await MatrimonyInterest.findOne({
      where: { fromUserId: otherId, toUserId: fromUserId, status: "ACCEPTED" }
    });
    if (reverse) {
      await reverse.update({ status: "WITHDRAWN", respondedAt: new Date() } as any);
    }
    return interest;
  }
  throw Object.assign(new Error("This interest cannot be withdrawn"), { status: 400 });
}

export async function listInterests(
  userId: number,
  direction: "sent" | "received"
): Promise<unknown[]> {
  const hub = await getMatrimonyHub(userId);
  assertCanBrowse(hub);

  const where =
    direction === "sent" ? { fromUserId: userId } : { toUserId: userId, status: { [Op.ne]: "WITHDRAWN" } };

  const rows = await MatrimonyInterest.findAll({
    where,
    order: [["updatedAt", "DESC"]],
    limit: 100
  });

  const otherIds = rows.map((r) => (direction === "sent" ? r.toUserId : r.fromUserId));
  const users = await User.findAll({ where: { id: { [Op.in]: otherIds } } });
  const profiles = await UserProfile.findAll({ where: { userId: { [Op.in]: otherIds } } });
  const userById = new Map(users.map((u) => [u.id, u]));
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return Promise.all(
    rows.map(async (row) => {
      const otherId = direction === "sent" ? row.toUserId : row.fromUserId;
      const u = userById.get(otherId)!;
      const prof = profileByUser.get(otherId);
      const m = normalizeJsonColumn(prof?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
      const candidate = resolveMatrimonyCandidate(u, m ?? {});
      const photoRaw = resolveCandidatePhotoUrl((m ?? {}) as Record<string, unknown>);
      const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;
      return {
        id: row.id,
        status: row.status,
        introMessage: row.introMessage,
        createdAt: row.createdAt.toISOString(),
        respondedAt: row.respondedAt?.toISOString() ?? null,
        candidate: { ...candidate, photoUrl }
      };
    })
  );
}

export async function listMatches(userId: number): Promise<unknown[]> {
  const hub = await getMatrimonyHub(userId);
  assertCanBrowse(hub);

  const rows = await MatrimonyMatch.findAll({
    where: {
      status: "ACTIVE",
      [Op.or]: [{ userLowId: userId }, { userHighId: userId }]
    },
    order: [["matchedAt", "DESC"]]
  });

  const otherIds = rows.map((r) => (r.userLowId === userId ? r.userHighId : r.userLowId));
  const users = await User.findAll({ where: { id: { [Op.in]: otherIds } } });
  const profiles = await UserProfile.findAll({ where: { userId: { [Op.in]: otherIds } } });
  const userById = new Map(users.map((u) => [u.id, u]));
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return Promise.all(
    rows.map(async (row) => {
      const otherId = row.userLowId === userId ? row.userHighId : row.userLowId;
      const u = userById.get(otherId)!;
      const prof = profileByUser.get(otherId);
      const m = normalizeJsonColumn(prof?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
      const candidate = resolveMatrimonyCandidate(u, m ?? {});
      const photoRaw = resolveCandidatePhotoUrl((m ?? {}) as Record<string, unknown>);
      const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;
      return {
        matchId: row.id,
        matchedAt: row.matchedAt.toISOString(),
        chatEnabled: row.chatEnabled,
        contactVisible: row.contactRevealed,
        horoscopeVisible: row.horoscopeShared,
        candidate: { ...candidate, photoUrl },
        contact: row.contactRevealed
          ? { mobile: u.mobile, email: null }
          : null
      };
    })
  );
}

export async function requestHoroscopeShare(
  viewerId: number,
  otherUserId: number
): Promise<{ requested: boolean }> {
  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  if (!match) {
    const err = new Error("Match required to request horoscope");
    (err as any).status = 403;
    throw err;
  }
  if (match.horoscopeShared) {
    return { requested: false };
  }
  void NotificationService.notifyHoroscopeRequest(otherUserId, viewerId).catch(() => {});
  return { requested: true };
}

export async function shareHoroscopeWithMatch(
  viewerId: number,
  otherUserId: number
): Promise<{ shared: boolean }> {
  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  if (!match) {
    const err = new Error("Match required to share horoscope");
    (err as any).status = 403;
    throw err;
  }
  const profile = await UserProfile.findOne({ where: { userId: viewerId } });
  const m = normalizeJsonColumn(profile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
  if (!m?.horoscopeDocumentUrl?.trim()) {
    const err = new Error("Upload horoscope on your matrimony profile first");
    (err as any).status = 400;
    throw err;
  }
  if (!match.horoscopeShared) {
    await match.update({ horoscopeShared: true } as any);
    void NotificationService.notifyHoroscopeShared(otherUserId, viewerId).catch(() => {});
  }
  return { shared: true };
}

export async function getHoroscopeForMatch(
  viewerId: number,
  otherUserId: number
): Promise<{ url: string | null; available: boolean }> {
  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  if (!match || !match.horoscopeShared) {
    const err = new Error("Horoscope available only after mutual match");
    (err as any).status = 403;
    throw err;
  }

  const profile = await UserProfile.findOne({ where: { userId: otherUserId } });
  const m = normalizeJsonColumn(profile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
  const raw = m?.horoscopeDocumentUrl;
  if (!raw?.trim()) return { url: null, available: false };
  const url = (await toSignedUrlIfR2(raw)) ?? raw;
  return { url, available: true };
}

export async function bothUsersHaveActiveMatrimony(userA: number, userB: number): Promise<boolean> {
  const profiles = await UserProfile.findAll({
    where: { userId: { [Op.in]: [userA, userB] } }
  });
  if (profiles.length < 2) return false;
  return profiles.every((p) => {
    const m = normalizeJsonColumn(p.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
    return isDiscoverableMatrimony(m);
  });
}

/** Gate for Messages.service — matrimony chat requires ACTIVE mutual match */
export async function assertMatrimonyChatAllowed(
  senderId: number,
  recipientId: number
): Promise<void> {
  await MatrimonySafety.assertNotBlocked(senderId, recipientId);
  const match = await getActiveMatrimonyMatch(senderId, recipientId);
  if (!match || !match.chatEnabled) {
    const err = new Error(
      "Matrimony chat unlocks only after both parties accept interest and become a mutual match."
    );
    (err as any).status = 403;
    (err as any).code = "MATRIMONY_CHAT_LOCKED";
    throw err;
  }
}

export async function getActiveMatchForContact(
  userId: number,
  otherUserId: number
): Promise<MatrimonyMatch> {
  const match = await getActiveMatrimonyMatch(userId, otherUserId);
  if (!match) {
    throw Object.assign(new Error("Contact available only after mutual match"), { status: 403 });
  }
  return match;
}

export async function revealContactIfMatched(
  viewerId: number,
  otherUserId: number
): Promise<{ mobile: string | null }> {
  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  if (!match) {
    const err = new Error("Contact available only after mutual match");
    (err as any).status = 403;
    throw err;
  }

  if (!(await Monetization.ensureMonetizationTables())) {
    throw Object.assign(new Error("Subscription billing is temporarily unavailable."), {
      status: 503,
      code: "MONETIZATION_UNAVAILABLE"
    });
  }
  await Monetization.assertContactRevealPaid(viewerId, otherUserId);

  if (!match.contactRevealed) {
    await match.update({ contactRevealed: true } as any);
  }
  const other = await User.findByPk(otherUserId, { attributes: ["mobile"] });
  return { mobile: other?.mobile ?? null };
}

/** Close matrimony match chat between two users (community connection unaffected). */
export async function closeMatrimonyMatchBetween(userA: number, userB: number): Promise<void> {
  const { low, high } = normalizeMatchPair(userA, userB);
  const match = await MatrimonyMatch.findOne({
    where: { userLowId: low, userHighId: high, status: "ACTIVE" }
  });
  if (match) {
    await match.update({ status: "UNMATCHED", chatEnabled: false } as any);
  }
}

/** User leaves matrimony module — close pending interests and active matches. */
export async function closeAllMatrimonyWorkflowForUser(userId: number): Promise<void> {
  await MatrimonyInterest.update(
    { status: "WITHDRAWN", respondedAt: new Date() } as any,
    {
      where: {
        status: "PENDING",
        [Op.or]: [{ fromUserId: userId }, { toUserId: userId }]
      }
    }
  );

  const accepted = await MatrimonyInterest.findAll({
    where: {
      status: "ACCEPTED",
      [Op.or]: [{ fromUserId: userId }, { toUserId: userId }]
    }
  });
  for (const row of accepted) {
    await row.update({ status: "WITHDRAWN", respondedAt: new Date() } as any);
    const otherId = row.fromUserId === userId ? row.toUserId : row.fromUserId;
    await closeMatrimonyMatchBetween(userId, otherId);
  }

  const matches = await MatrimonyMatch.findAll({
    where: {
      status: "ACTIVE",
      [Op.or]: [{ userLowId: userId }, { userHighId: userId }]
    }
  });
  for (const m of matches) {
    await m.update({ status: "UNMATCHED", chatEnabled: false } as any);
  }
}

/** Proactive chat lock state for mobile Messages UI. */
export async function getMatrimonyChatAccess(
  viewerId: number,
  otherUserId: number
): Promise<{ matrimonyGateApplies: boolean; allowed: boolean; code?: string; message?: string }> {
  const gateApplies = await bothUsersHaveActiveMatrimony(viewerId, otherUserId);
  if (!gateApplies) return { matrimonyGateApplies: false, allowed: true };
  try {
    await assertMatrimonyChatAllowed(viewerId, otherUserId);
    return { matrimonyGateApplies: true, allowed: true };
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    return {
      matrimonyGateApplies: true,
      allowed: false,
      code: err.code ?? "MATRIMONY_CHAT_LOCKED",
      message: err.message ?? "Chat available after mutual match."
    };
  }
}
