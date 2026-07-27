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
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import type { MatrimonySection } from "../models/UserProfile.model";

export type MessageAccessReason =
  | "matrimony_match"
  | "connection"
  | "legacy_thread"
  | "blocked"
  | "no_permission";

export type ChatLane = "community" | "matrimony";

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
  allowed: boolean;
  canViewHistory: boolean;
  readOnly: boolean;
  primaryLane: ChatLane | null;
  chatLanes: ChatLane[];
  code?: string;
  message?: string;
  reason?: MessageAccessReason;
};

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

function buildAccessDto(
  community: LaneAccess,
  matrimony: LaneAccess,
  legacy: boolean
): MessageAccessDto {
  const allowed = community.allowed || matrimony.allowed;
  const chatLanes: ChatLane[] = [];
  if (community.allowed) chatLanes.push("community");
  if (matrimony.allowed) chatLanes.push("matrimony");
  if (!matrimony.allowed && matrimony.applicable && matrimony.readOnly) {
    chatLanes.push("matrimony");
  }

  let canViewHistory = allowed;
  let readOnly = false;
  let code: string | undefined;
  let message: string | undefined;
  let reason: MessageAccessReason | undefined;

  if (allowed) {
    reason = community.allowed ? "connection" : "matrimony_match";
    canViewHistory = true;
  } else if (legacy) {
    canViewHistory = true;
    readOnly = true;
    reason = "legacy_thread";
    code = "READ_ONLY_LEGACY";
    message =
      community.allowed === false && matrimony.applicable
        ? "You can view past messages, but new messages need an accepted connection or an active matrimony match."
        : "You can view past messages, but messaging unlocks after connection is accepted or you become a mutual matrimony match.";
  } else {
    canViewHistory = false;
    reason = "no_permission";
    code = matrimony.applicable ? matrimony.code : community.code ?? "MESSAGING_LOCKED";
    message =
      matrimony.message ??
      community.message ??
      "Messaging is available only after connection is accepted or mutual matrimony interest is accepted.";
  }

  let primaryLane: ChatLane | null = null;
  if (community.allowed && matrimony.allowed) primaryLane = "community";
  else if (community.allowed) primaryLane = "community";
  else if (matrimony.allowed) primaryLane = "matrimony";
  else if (matrimony.applicable && matrimony.readOnly) primaryLane = "matrimony";
  else if (community.applicable) primaryLane = "community";

  return {
    communityChat: community,
    matrimonyChat: matrimony,
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

/** Central permission check — community and matrimony lanes are independent (Phase 4). */
export async function getMessageAccess(
  viewerId: number,
  otherUserId: number
): Promise<MessageAccessDto> {
  if (!viewerId || !otherUserId || viewerId === otherUserId) {
    const denied: LaneAccess = { applicable: false, allowed: false, readOnly: false };
    return {
      communityChat: denied,
      matrimonyChat: denied,
      allowed: false,
      canViewHistory: false,
      readOnly: false,
      primaryLane: null,
      chatLanes: [],
      code: "INVALID",
      message: "Invalid user."
    };
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

  return buildAccessDto(community, matrimony, legacy);
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
      // Only matrimony JSON is needed for discoverable flags — avoid selecting other fat columns.
      attributes: ["userId", "matrimony"]
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
  for (const p of profiles) {
    const m = normalizeJsonColumn(p.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection;
    matrimonyActive.set(p.userId, isDiscoverableMatrimony(m));
  }
  const viewerHasMatrimony = matrimonyActive.get(viewerId) === true;

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
    map.set(otherId, buildAccessDto(community, matrimony, legacy));
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
