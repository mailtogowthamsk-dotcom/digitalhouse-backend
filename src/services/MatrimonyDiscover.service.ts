import { Op } from "sequelize";
import {
  User,
  UserProfile,
  MatrimonyInterest,
  MatrimonyMatch
} from "../models";
import type { MatrimonySection } from "../models/UserProfile.model";
import { getMatrimonyHub } from "./Matrimony.service";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { resolveCandidatePhotoUrl } from "../constants/matrimony-photo.constants";
import {
  calcAgeFromDob,
  kulamCompatibilityLabel,
  normalizeMatchPair,
  resolveMatrimonyCandidate,
  type MatrimonyCandidatePublic
} from "../utils/matrimonyCandidate.util";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { Location } from "../models";

export type DiscoverCardDto = {
  userId: number;
  name: string;
  age: number | null;
  district: string | null;
  occupation: string | null;
  education: string | null;
  kulamLabel: string | null;
  photoUrl: string | null;
  familyManaged: boolean;
  horoscopeAvailable: boolean;
  verified: boolean;
  interestSent: boolean;
  interestReceived: boolean;
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
};

function assertCanBrowse(hub: Awaited<ReturnType<typeof getMatrimonyHub>>): void {
  if (!hub.can_browse) {
    const err = new Error(
      hub.status === "APPROVED"
        ? "Matrimony profile is not active for browsing."
        : "Complete matrimony approval before browsing profiles."
    );
    (err as any).status = 403;
    throw err;
  }
}

function isDiscoverableMatrimony(m: MatrimonySection | null): boolean {
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

function passesReverseAgePreference(
  candidateM: MatrimonySection,
  viewerAge: number | null
): boolean {
  if (viewerAge == null) return true;
  const min = candidateM.partnerAgeMin;
  const max = candidateM.partnerAgeMax;
  if (min != null && viewerAge < min) return false;
  if (max != null && viewerAge > max) return false;
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
  return names.some((n) => candidateDistrict.toLowerCase().includes(n!));
}

async function loadLocationMap(): Promise<Map<number, string>> {
  const rows = await Location.findAll({ attributes: ["id", "name"] });
  return new Map(rows.map((l) => [l.id, l.name]));
}

async function getActiveMatch(userId: number, otherUserId: number): Promise<MatrimonyMatch | null> {
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
        horoscopeShared: true,
        matchedAt: new Date()
      } as any
    });
    if (match.status !== "ACTIVE") {
      await match.update({ status: "ACTIVE", matchedAt: new Date(), horoscopeShared: true } as any);
    }
    return match;
  } catch (err) {
    console.warn("[MatrimonyDiscover] match create skipped — run matrimony-phase2.sql", err);
    return null;
  }
}

export async function discoverProfiles(
  viewerId: number,
  opts: { page?: number; limit?: number; district?: string }
): Promise<{ items: DiscoverCardDto[]; total: number; page: number; limit: number }> {
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
    include: [
      {
        model: User,
        required: true,
        where: { status: "APPROVED", id: { [Op.ne]: viewerId } }
      }
    ]
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

  for (const row of rows) {
    const user = (row as any).User as User;
    const m = normalizeJsonColumn(row.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection | null;
    if (!isDiscoverableMatrimony(m)) continue;

    const candidate = resolveMatrimonyCandidate(user, m!);
    const candidateKulam = candidate.kulam;

    if (viewerK && candidateKulam && viewerK.trim().toLowerCase() === candidateKulam.trim().toLowerCase()) {
      continue;
    }

    if (!passesGenderPreference(viewerM, candidate)) continue;
    if (!passesAgePreference(viewerM, candidate.age)) continue;
    if (!passesReverseAgePreference(m!, viewerAge)) continue;
    if (!passesDistrictPreference(viewerM, candidate.district, locationMap)) continue;

    if (opts.district && candidate.district) {
      if (!candidate.district.toLowerCase().includes(opts.district.toLowerCase())) continue;
    }

    const photoRaw = resolveCandidatePhotoUrl(m as Record<string, unknown>);
    const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;

    const compat = kulamCompatibilityLabel(viewerK, candidateKulam);
    const int = interestByOther.get(user.id);

    cards.push({
      userId: user.id,
      name: candidate.name,
      age: candidate.age,
      district: candidate.district,
      occupation: candidate.occupation,
      education: candidate.education,
      kulamLabel: compat === "Compatible" ? "Compatible kulam" : compat === "Different kulam" ? candidateKulam : candidateKulam,
      photoUrl,
      familyManaged: candidate.familyManaged,
      horoscopeAvailable: candidate.horoscopeAvailable,
      verified: candidate.verified,
      interestSent: !!int?.sent,
      interestReceived: !!int?.received
    });
  }

  const viewerDistrict = viewerCandidate.district;
  const scoreCard = (c: DiscoverCardDto) => {
    let s = c.verified ? 4 : 0;
    if (c.horoscopeAvailable) s += 1;
    if (
      viewerDistrict &&
      c.district &&
      c.district.toLowerCase() === viewerDistrict.toLowerCase()
    ) {
      s += 2;
    }
    return s;
  };
  cards.sort((a, b) => scoreCard(b) - scoreCard(a));

  const total = cards.length;
  const offset = (page - 1) * limit;
  const pageItems = cards.slice(offset, offset + limit);

  return { items: pageItems, total, page, limit };
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
  if (!isDiscoverableMatrimony(m)) {
    throw Object.assign(new Error("Matrimony profile not available"), { status: 404 });
  }

  const viewerM = normalizeJsonColumn(
    viewerProfile?.matrimony,
    SECTION_ALLOWED_KEYS.matrimony
  ) as MatrimonySection;
  const viewerK = viewerKulam(viewerProfile, viewer!);
  const candidate = resolveMatrimonyCandidate(candidateUser, m!);

  if (
    viewerK &&
    candidate.kulam &&
    viewerK.trim().toLowerCase() === candidate.kulam.trim().toLowerCase()
  ) {
    throw Object.assign(new Error("Profile not available"), { status: 404 });
  }

  const photoRaw = resolveCandidatePhotoUrl(m as Record<string, unknown>);
  const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;

  const match = await getActiveMatch(viewerId, candidateUserId);

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

  return {
    ...candidate,
    photoUrl,
    rashi: m!.rashi ?? null,
    nakshatram: m!.nakshatram ?? null,
    maritalStatus: m!.maritalStatus ?? null,
    dosham: m!.dosham ?? null,
    kulamLabel: kulamCompatibilityLabel(viewerK, candidate.kulam),
    interestStatus,
    canSendInterest:
      !mutualMatch &&
      (!sentInterest || sentInterest.status === "WITHDRAWN" || sentInterest.status === "DECLINED"),
    canRespondInterest: recvInterest?.status === "PENDING",
    pendingInterestId: recvInterest?.status === "PENDING" ? recvInterest.id : null,
    mutualMatch,
    chatEnabled: mutualMatch && (match?.chatEnabled ?? false),
    contactVisible: mutualMatch && (match?.contactRevealed ?? false),
    horoscopeVisible
  };
}

export async function sendInterest(
  fromUserId: number,
  toUserId: number,
  introMessage?: string
): Promise<{ interest: MatrimonyInterest; mutualMatch: boolean }> {
  const hub = await getMatrimonyHub(fromUserId);
  assertCanBrowse(hub);

  if (fromUserId === toUserId) {
    throw Object.assign(new Error("Invalid recipient"), { status: 400 });
  }

  const existing = await MatrimonyInterest.findOne({
    where: { fromUserId, toUserId }
  });
  if (existing?.status === "PENDING") {
    throw Object.assign(new Error("Interest already sent"), { status: 400 });
  }
  if (existing?.status === "ACCEPTED") {
    throw Object.assign(new Error("Interest already accepted"), { status: 400 });
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
  return { interest, mutualMatch: !!match };
}

export async function respondToInterest(
  userId: number,
  interestId: number,
  action: "ACCEPT" | "DECLINE"
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
  if (interest.status !== "PENDING") {
    throw Object.assign(new Error("Can only withdraw pending interest"), { status: 400 });
  }
  await interest.update({ status: "WITHDRAWN", respondedAt: new Date() } as any);
  return interest;
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

export async function getHoroscopeForMatch(
  viewerId: number,
  otherUserId: number
): Promise<{ url: string | null; available: boolean }> {
  const match = await getActiveMatch(viewerId, otherUserId);
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
  const match = await getActiveMatch(senderId, recipientId);
  if (!match || !match.chatEnabled) {
    const err = new Error(
      "Matrimony chat unlocks only after both parties accept interest and become a mutual match."
    );
    (err as any).status = 403;
    (err as any).code = "MATRIMONY_CHAT_LOCKED";
    throw err;
  }
}

export async function revealContactIfMatched(
  viewerId: number,
  otherUserId: number
): Promise<{ mobile: string | null }> {
  const match = await getActiveMatch(viewerId, otherUserId);
  if (!match) {
    const err = new Error("Contact available only after mutual match");
    (err as any).status = 403;
    throw err;
  }
  if (!match.contactRevealed) {
    await match.update({ contactRevealed: true } as any);
  }
  const other = await User.findByPk(otherUserId, { attributes: ["mobile"] });
  return { mobile: other?.mobile ?? null };
}
