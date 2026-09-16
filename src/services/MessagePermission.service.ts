/**
 * Messaging permission — independent chat lanes:
 * - community: accepted Connection
 * - matrimony: mutual match with chatEnabled (or legacy read-only)
 * - business: either party has an approved + active Business Profile
 *
 * Business enquiries reuse the existing messages table without creating Connections.
 */

import { Op, QueryTypes } from "sequelize";
import { Message, MatrimonyMatch, UserProfile, MemberConnection } from "../models";
import { sequelize } from "../config/db";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  bothUsersHaveActiveMatrimony,
  getActiveMatrimonyMatch,
  isDiscoverableMatrimony
} from "./MatrimonyDiscover.service";
import { hasAcceptedConnection } from "./Connection.service";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS, toPublicBusinessProfile } from "./Profile.service";
import type { MatrimonySection } from "../models/UserProfile.model";

export type MessageAccessReason =
  | "matrimony_match"
  | "connection"
  | "business"
  | "legacy_thread"
  | "blocked"
  | "no_permission";

export type ChatLane = "community" | "matrimony" | "business";

export type LaneAccess = {
  applicable: boolean;
  allowed: boolean;
  readOnly: boolean;
  code?: string;
  message?: string;
};

export type MessageAccessDto = {
  communityChat: LaneAccess;
  matrimonyChat: LaneAccess;
  businessChat: LaneAccess;
  allowed: boolean;
  canViewHistory: boolean;
  readOnly: boolean;
  primaryLane: ChatLane | null;
  chatLanes: ChatLane[];
  code?: string;
  message?: string;
  reason?: MessageAccessReason;
};

const DENIED_LANE: LaneAccess = { applicable: false, allowed: false, readOnly: false };

async function hasMessageHistory(userA: number, userB: number): Promise<boolean> {
  const row = await Message.findOne({
    where: {
      [Op.or]: [
        { senderId: userA, recipientId: userB },
        { senderId: userB, recipientId: userA }
      ]
    },
    attributes: ["id"]
  });
  return row != null;
}

function communityLaneFromConnected(connected: boolean): LaneAccess {
  if (connected) {
    return { applicable: true, allowed: true, readOnly: false };
  }
  return {
    applicable: true,
    allowed: false,
    readOnly: false,
    code: "COMMUNITY_CHAT_LOCKED",
    message: "Community chat is available after connection is accepted."
  };
}

function matrimonyLaneFromState(opts: {
  matrimonyContext: boolean;
  matchChatEnabled: boolean;
  legacy: boolean;
}): LaneAccess {
  if (!opts.matrimonyContext) {
    return { applicable: false, allowed: false, readOnly: false };
  }
  if (opts.matchChatEnabled) {
    return { applicable: true, allowed: true, readOnly: false };
  }
  if (opts.legacy) {
    return {
      applicable: true,
      allowed: false,
      readOnly: true,
      code: "MATRIMONY_CHAT_ARCHIVED",
      message:
        "Matrimony chat is closed. Community chat may still be available if you are connected."
    };
  }
  return {
    applicable: true,
    allowed: false,
    readOnly: false,
    code: "MATRIMONY_CHAT_LOCKED",
    message:
      "Matrimony chat is available only after both parties accept interest and become a mutual match."
  };
}

/**
 * Business lane (no Connection required):
 * - Member → owner: allowed when the other user has an approved+active Business Profile
 * - Owner → member: allowed only after a thread already exists (enquiry / prior chat)
 *   so owners cannot cold-message arbitrary members just because they have a business.
 */
function businessLaneFromActive(opts: {
  otherHasBusiness: boolean;
  selfHasBusiness: boolean;
  hasHistory: boolean;
}): LaneAccess {
  if (opts.otherHasBusiness) {
    return { applicable: true, allowed: true, readOnly: false };
  }
  if (opts.selfHasBusiness && opts.hasHistory) {
    return { applicable: true, allowed: true, readOnly: false };
  }
  if (opts.selfHasBusiness) {
    return {
      applicable: true,
      allowed: false,
      readOnly: false,
      code: "BUSINESS_CHAT_LOCKED",
      message: "Business chat unlocks after a member contacts your Business Profile."
    };
  }
  return {
    applicable: false,
    allowed: false,
    readOnly: false,
    code: "BUSINESS_CHAT_LOCKED",
    message: "Business chat is available when a party has an approved active Business Profile."
  };
}

function profileHasActiveBusiness(businessRaw: unknown): boolean {
  return toPublicBusinessProfile(businessRaw) != null;
}

async function getCommunityLane(viewerId: number, otherUserId: number): Promise<LaneAccess> {
  const connected = await hasAcceptedConnection(viewerId, otherUserId);
  return communityLaneFromConnected(connected);
}

async function getMatrimonyLane(viewerId: number, otherUserId: number): Promise<LaneAccess> {
  const matrimonyContext = await bothUsersHaveActiveMatrimony(viewerId, otherUserId);
  if (!matrimonyContext) {
    return matrimonyLaneFromState({
      matrimonyContext: false,
      matchChatEnabled: false,
      legacy: false
    });
  }

  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  const legacy = await hasMessageHistory(viewerId, otherUserId);
  return matrimonyLaneFromState({
    matrimonyContext: true,
    matchChatEnabled: !!match?.chatEnabled,
    legacy
  });
}

async function getBusinessLane(
  viewerId: number,
  otherUserId: number,
  hasHistory: boolean
): Promise<LaneAccess> {
  const profiles = await UserProfile.findAll({
    where: { userId: { [Op.in]: [viewerId, otherUserId] } },
    attributes: ["userId", "business"]
  });
  let selfHas = false;
  let otherHas = false;
  for (const p of profiles) {
    const active = profileHasActiveBusiness(p.business);
    if (p.userId === viewerId) selfHas = active;
    if (p.userId === otherUserId) otherHas = active;
  }
  return businessLaneFromActive({
    otherHasBusiness: otherHas,
    selfHasBusiness: selfHas,
    hasHistory
  });
}

function buildAccessDto(
  community: LaneAccess,
  matrimony: LaneAccess,
  business: LaneAccess,
  legacy: boolean
): MessageAccessDto {
  const allowed = community.allowed || matrimony.allowed || business.allowed;
  const chatLanes: ChatLane[] = [];
  if (community.allowed) chatLanes.push("community");
  if (matrimony.allowed) chatLanes.push("matrimony");
  if (!matrimony.allowed && matrimony.applicable && matrimony.readOnly) {
    chatLanes.push("matrimony");
  }
  if (business.allowed) chatLanes.push("business");

  let canViewHistory = allowed;
  let readOnly = false;
  let code: string | undefined;
  let message: string | undefined;
  let reason: MessageAccessReason | undefined;

  if (allowed) {
    if (community.allowed) reason = "connection";
    else if (matrimony.allowed) reason = "matrimony_match";
    else reason = "business";
    canViewHistory = true;
  } else if (legacy) {
    canViewHistory = true;
    readOnly = true;
    reason = "legacy_thread";
    code = "READ_ONLY_LEGACY";
    message =
      "You can view past messages, but messaging unlocks after connection is accepted, a mutual matrimony match, or an active Business Profile.";
  } else {
    canViewHistory = false;
    reason = "no_permission";
    code =
      matrimony.applicable && !matrimony.allowed
        ? matrimony.code
        : community.code ?? "MESSAGING_LOCKED";
    message =
      matrimony.message ??
      community.message ??
      "Messaging is available only after connection is accepted or mutual matrimony interest is accepted.";
  }

  let primaryLane: ChatLane | null = null;
  if (community.allowed && matrimony.allowed) primaryLane = "community";
  else if (community.allowed) primaryLane = "community";
  else if (matrimony.allowed) primaryLane = "matrimony";
  else if (business.allowed) primaryLane = "business";
  else if (matrimony.applicable && matrimony.readOnly) primaryLane = "matrimony";
  else if (community.applicable) primaryLane = "community";

  return {
    communityChat: community,
    matrimonyChat: matrimony,
    businessChat: business,
    allowed,
    canViewHistory,
    readOnly,
    primaryLane,
    chatLanes,
    code,
    message,
    reason
  };
}

function deniedAccess(
  patch: Partial<MessageAccessDto> & { code?: string; message?: string; reason?: MessageAccessReason }
): MessageAccessDto {
  return {
    communityChat: DENIED_LANE,
    matrimonyChat: DENIED_LANE,
    businessChat: DENIED_LANE,
    allowed: false,
    canViewHistory: false,
    readOnly: false,
    primaryLane: null,
    chatLanes: [],
    ...patch
  };
}

/** Central permission check — community, matrimony, and business lanes are independent. */
export async function getMessageAccess(
  viewerId: number,
  otherUserId: number
): Promise<MessageAccessDto> {
  if (!viewerId || !otherUserId || viewerId === otherUserId) {
    return deniedAccess({ code: "INVALID", message: "Invalid user." });
  }

  const blocked = await getBlockedUserIds(viewerId);
  if (blocked.has(otherUserId)) {
    const denied: LaneAccess = {
      applicable: false,
      allowed: false,
      readOnly: false,
      code: "BLOCKED",
      message: "You cannot message this user."
    };
    return {
      communityChat: denied,
      matrimonyChat: denied,
      businessChat: denied,
      allowed: false,
      canViewHistory: false,
      readOnly: false,
      primaryLane: null,
      chatLanes: [],
      code: "BLOCKED",
      message: "You cannot message this user.",
      reason: "blocked"
    };
  }

  const [community, matrimony, legacy] = await Promise.all([
    getCommunityLane(viewerId, otherUserId),
    getMatrimonyLane(viewerId, otherUserId),
    hasMessageHistory(viewerId, otherUserId)
  ]);
  const business = await getBusinessLane(viewerId, otherUserId, legacy);

  return buildAccessDto(community, matrimony, business, legacy);
}

/**
 * Batch permission map — fixed DB round-trips instead of N× getMessageAccess
 * (Critical N+1 fix for listThreads).
 */
export async function getMessageAccessMap(
  viewerId: number,
  otherUserIds: number[]
): Promise<Map<number, MessageAccessDto>> {
  const map = new Map<number, MessageAccessDto>();
  const unique = [...new Set(otherUserIds.filter((id) => id && id !== viewerId))];
  if (!unique.length) return map;

  const blocked = await getBlockedUserIds(viewerId);
  const remaining = unique.filter((id) => {
    if (blocked.has(id)) {
      const denied: LaneAccess = {
        applicable: false,
        allowed: false,
        readOnly: false,
        code: "BLOCKED",
        message: "You cannot message this user."
      };
      map.set(id, {
        communityChat: denied,
        matrimonyChat: denied,
        businessChat: denied,
        allowed: false,
        canViewHistory: false,
        readOnly: false,
        primaryLane: null,
        chatLanes: [],
        code: "BLOCKED",
        message: "You cannot message this user.",
        reason: "blocked"
      });
      return false;
    }
    return true;
  });

  if (!remaining.length) return map;

  const profileIds = [...new Set([viewerId, ...remaining])];

  const [connections, matches, profiles, legacyRows] = await Promise.all([
    MemberConnection.findAll({
      where: {
        status: "ACCEPTED",
        [Op.or]: remaining.flatMap((otherId) => [
          { requesterUserId: viewerId, recipientUserId: otherId },
          { requesterUserId: otherId, recipientUserId: viewerId }
        ])
      },
      attributes: ["requesterUserId", "recipientUserId"]
    }),
    MatrimonyMatch.findAll({
      where: {
        status: "ACTIVE",
        [Op.or]: [
          { userLowId: viewerId, userHighId: { [Op.in]: remaining } },
          { userHighId: viewerId, userLowId: { [Op.in]: remaining } }
        ]
      },
      attributes: ["userLowId", "userHighId", "chatEnabled"]
    }).catch(() => [] as MatrimonyMatch[]),
    UserProfile.findAll({
      where: { userId: { [Op.in]: profileIds } },
      attributes: ["userId", "matrimony", "business"]
    }),
    sequelize.query<{ otherUserId: number }>(
      `
      SELECT DISTINCT IF(senderId = :me, recipientId, senderId) AS otherUserId
      FROM messages
      WHERE (senderId = :me AND recipientId IN (:ids))
         OR (recipientId = :me AND senderId IN (:ids))
      `,
      { type: QueryTypes.SELECT, replacements: { me: viewerId, ids: remaining } }
    )
  ]);

  const legacyPeers = new Set(legacyRows.map((r) => Number(r.otherUserId)));

  const connectedPeers = new Set<number>();
  for (const c of connections) {
    connectedPeers.add(
      c.requesterUserId === viewerId ? c.recipientUserId : c.requesterUserId
    );
  }

  const matchByOther = new Map<number, { chatEnabled: boolean }>();
  for (const m of matches) {
    const other = m.userLowId === viewerId ? m.userHighId : m.userLowId;
    matchByOther.set(other, { chatEnabled: !!(m as any).chatEnabled });
  }

  const matrimonyActive = new Map<number, boolean>();
  const businessActive = new Map<number, boolean>();
  for (const p of profiles) {
    const m = normalizeJsonColumn(p.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
    matrimonyActive.set(p.userId, isDiscoverableMatrimony(m));
    businessActive.set(p.userId, profileHasActiveBusiness(p.business));
  }
  const viewerHasMatrimony = matrimonyActive.get(viewerId) === true;
  const viewerHasBusiness = businessActive.get(viewerId) === true;

  for (const otherId of remaining) {
    const community = communityLaneFromConnected(connectedPeers.has(otherId));
    const bothMatrimony = viewerHasMatrimony && matrimonyActive.get(otherId) === true;
    const match = matchByOther.get(otherId);
    const legacy = legacyPeers.has(otherId);
    const matrimony = matrimonyLaneFromState({
      matrimonyContext: bothMatrimony,
      matchChatEnabled: !!match?.chatEnabled,
      legacy
    });
    const business = businessLaneFromActive({
      otherHasBusiness: businessActive.get(otherId) === true,
      selfHasBusiness: viewerHasBusiness,
      hasHistory: legacy
    });
    map.set(otherId, buildAccessDto(community, matrimony, business, legacy));
  }

  return map;
}

export async function assertCanSendMessage(senderId: number, recipientId: number): Promise<void> {
  const access = await getMessageAccess(senderId, recipientId);
  if (!access.allowed) {
    const err = new Error(access.message ?? "Cannot message this user.");
    (err as any).status = 403;
    (err as any).code = access.code ?? "MESSAGING_LOCKED";
    throw err;
  }
}

export async function assertCanViewHistory(
  me: number,
  otherUserId: number
): Promise<MessageAccessDto> {
  const access = await getMessageAccess(me, otherUserId);
  if (!access.canViewHistory) {
    const err = new Error(access.message ?? "You cannot view this conversation.");
    (err as any).status = 403;
    (err as any).code = access.code ?? "MESSAGING_LOCKED";
    throw err;
  }
  return access;
}
