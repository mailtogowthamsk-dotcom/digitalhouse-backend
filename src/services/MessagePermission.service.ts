import { Op } from "sequelize";
import { Message } from "../models";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  bothUsersHaveActiveMatrimony,
  getActiveMatrimonyMatch
} from "./MatrimonyDiscover.service";
import { hasAcceptedConnection } from "./Connection.service";

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

async function getCommunityLane(viewerId: number, otherUserId: number): Promise<LaneAccess> {
  const connected = await hasAcceptedConnection(viewerId, otherUserId);
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

async function getMatrimonyLane(viewerId: number, otherUserId: number): Promise<LaneAccess> {
  const matrimonyContext = await bothUsersHaveActiveMatrimony(viewerId, otherUserId);
  if (!matrimonyContext) {
    return { applicable: false, allowed: false, readOnly: false };
  }

  const match = await getActiveMatrimonyMatch(viewerId, otherUserId);
  if (match?.chatEnabled) {
    return { applicable: true, allowed: true, readOnly: false };
  }

  const legacy = await hasMessageHistory(viewerId, otherUserId);
  if (legacy) {
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
    // Do NOT say "archived" here — that confuses users with Inbox archive (thread preference).
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

export async function getMessageAccessMap(
  viewerId: number,
  otherUserIds: number[]
): Promise<Map<number, MessageAccessDto>> {
  const map = new Map<number, MessageAccessDto>();
  const unique = [...new Set(otherUserIds.filter((id) => id && id !== viewerId))];
  await Promise.all(
    unique.map(async (id) => {
      map.set(id, await getMessageAccess(viewerId, id));
    })
  );
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
