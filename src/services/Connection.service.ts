import { Op } from "sequelize";
import { MemberConnection, User } from "../models";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  notifyConnectionRequestAccepted,
  notifyConnectionRequestReceived
} from "./Notification.service";

export type RelationshipStatus =
  | "none"
  | "pending_sent"
  | "pending_received"
  | "connected"
  | "rejected";

const REJECTION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const DISCONNECT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUEST_ATTEMPTS = 2;

export type ConnectionUserDto = {
  id: number;
  fullName: string;
  username: string;
  profileImage: string | null;
};

export type ConnectionRequestDto = {
  id: number;
  user: ConnectionUserDto;
  createdAt: string;
};

function serviceError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function pairWhere(a: number, b: number) {
  return {
    [Op.or]: [
      { requesterUserId: a, recipientUserId: b },
      { requesterUserId: b, recipientUserId: a }
    ]
  };
}

function directedWhere(requesterId: number, recipientId: number) {
  return { requesterUserId: requesterId, recipientUserId: recipientId };
}

async function assertEligibleUsers(requesterId: number, recipientId: number): Promise<void> {
  if (requesterId === recipientId) serviceError("Invalid member.", 400, "INVALID_USER");
  const blocked = await getBlockedUserIds(requesterId);
  if (blocked.has(recipientId)) {
    serviceError("You cannot connect with this member.", 403, "BLOCKED");
  }
  const recipient = await User.findByPk(recipientId, {
    attributes: ["id", "status", "username", "allowConnectionRequests"]
  });
  if (!recipient || recipient.status !== "APPROVED" || !recipient.username) {
    serviceError("Member not found.", 404, "MEMBER_NOT_FOUND");
  }
  if (recipient.allowConnectionRequests === false) {
    serviceError("This member is not accepting connection requests.", 403, "CONNECTION_REQUESTS_DISABLED");
  }
}

function deriveStatus(
  viewerId: number,
  rows: MemberConnection[]
): RelationshipStatus {
  const accepted = rows.find((r) => r.status === "ACCEPTED");
  if (accepted) return "connected";

  const incoming = rows.find(
    (r) => r.status === "PENDING" && r.recipientUserId === viewerId
  );
  if (incoming) return "pending_received";

  const outgoing = rows.find(
    (r) => r.status === "PENDING" && r.requesterUserId === viewerId
  );
  if (outgoing) return "pending_sent";

  const rejectedByThem = rows.find(
    (r) => r.status === "REJECTED" && r.requesterUserId === viewerId
  );
  if (rejectedByThem) return "rejected";

  return "none";
}

export async function getRelationshipStatus(
  viewerId: number,
  otherUserId: number
): Promise<RelationshipStatus> {
  if (!viewerId || !otherUserId || viewerId === otherUserId) return "none";
  const rows = await MemberConnection.findAll({
    where: pairWhere(viewerId, otherUserId)
  });
  return deriveStatus(viewerId, rows);
}

export async function getRelationshipStatusMap(
  viewerId: number,
  otherUserIds: number[]
): Promise<Map<number, RelationshipStatus>> {
  const map = new Map<number, RelationshipStatus>();
  const unique = [...new Set(otherUserIds.filter((id) => id && id !== viewerId))];
  for (const id of unique) map.set(id, "none");
  if (!unique.length) return map;

  const rows = await MemberConnection.findAll({
    where: {
      [Op.or]: unique.flatMap((otherId) => [
        { requesterUserId: viewerId, recipientUserId: otherId },
        { requesterUserId: otherId, recipientUserId: viewerId }
      ])
    }
  });

  const byOther = new Map<number, MemberConnection[]>();
  for (const row of rows) {
    const otherId =
      row.requesterUserId === viewerId ? row.recipientUserId : row.requesterUserId;
    const list = byOther.get(otherId) ?? [];
    list.push(row);
    byOther.set(otherId, list);
  }

  for (const otherId of unique) {
    map.set(otherId, deriveStatus(viewerId, byOther.get(otherId) ?? []));
  }
  return map;
}

export async function hasAcceptedConnection(userA: number, userB: number): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;
  const row = await MemberConnection.findOne({
    where: { ...pairWhere(userA, userB), status: "ACCEPTED" },
    attributes: ["id"]
  });
  return row != null;
}

async function toUserDto(userId: number): Promise<ConnectionUserDto> {
  const u = await User.findByPk(userId, {
    attributes: ["id", "fullName", "username", "profilePhoto"]
  });
  if (!u || !u.username) serviceError("Member not found.", 404, "MEMBER_NOT_FOUND");
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username,
    profileImage: u.profilePhoto ?? null
  };
}

async function toUserDtoMap(userIds: number[]): Promise<Map<number, ConnectionUserDto>> {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, ConnectionUserDto>();
  if (!unique.length) return map;
  const users = await User.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ["id", "fullName", "username", "profilePhoto"]
  });
  for (const u of users) {
    if (!u.username) continue;
    map.set(u.id, {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      profileImage: u.profilePhoto ?? null
    });
  }
  return map;
}

async function acceptRow(row: MemberConnection): Promise<MemberConnection> {
  await row.update({ status: "ACCEPTED", respondedAt: new Date() });
  return row;
}

export async function sendRequest(
  requesterId: number,
  recipientId: number
): Promise<{ status: RelationshipStatus; autoAccepted: boolean }> {
  await assertEligibleUsers(requesterId, recipientId);

  const rows = await MemberConnection.findAll({
    where: pairWhere(requesterId, recipientId)
  });

  const accepted = rows.find((r) => r.status === "ACCEPTED");
  if (accepted) serviceError("You are already connected.", 400, "ALREADY_CONNECTED");

  const outgoingPending = rows.find(
    (r) => r.status === "PENDING" && r.requesterUserId === requesterId
  );
  if (outgoingPending) {
    serviceError("Connection request already sent.", 400, "REQUEST_PENDING");
  }

  const incomingPending = rows.find(
    (r) => r.status === "PENDING" && r.recipientUserId === requesterId
  );
  if (incomingPending) {
    await acceptRow(incomingPending);
    const other = rows.find(
      (r) => r.status === "PENDING" && r.requesterUserId === requesterId
    );
    if (other) await other.update({ status: "CANCELLED", respondedAt: new Date() });
    void notifyConnectionRequestAccepted(recipientId, requesterId).catch(() => {});
    void notifyConnectionRequestAccepted(requesterId, recipientId).catch(() => {});
    return { status: "connected", autoAccepted: true };
  }

  const outgoing = rows.find((r) => r.requesterUserId === requesterId);

  if (outgoing?.status === "REJECTED") {
    if (outgoing.attemptCount >= MAX_REQUEST_ATTEMPTS) {
      serviceError(
        "You cannot send more requests to this member. They must send you a request.",
        403,
        "REQUEST_LIMIT"
      );
    }
    const elapsed = Date.now() - (outgoing.respondedAt?.getTime() ?? 0);
    if (elapsed < REJECTION_COOLDOWN_MS) {
      serviceError(
        "Please wait 30 days after a rejection before sending another request.",
        403,
        "REJECTION_COOLDOWN"
      );
    }
    await outgoing.update({
      status: "PENDING",
      attemptCount: outgoing.attemptCount + 1,
      respondedAt: null
    });
    void notifyConnectionRequestReceived(recipientId, requesterId).catch(() => {});
    return { status: "pending_sent", autoAccepted: false };
  }

  if (outgoing?.status === "CANCELLED") {
    const elapsed = Date.now() - (outgoing.respondedAt?.getTime() ?? 0);
    if (elapsed < DISCONNECT_COOLDOWN_MS) {
      serviceError(
        "Please wait 7 days after disconnecting before sending a new request.",
        403,
        "DISCONNECT_COOLDOWN"
      );
    }
    await outgoing.update({
      status: "PENDING",
      attemptCount: 1,
      respondedAt: null
    });
    void notifyConnectionRequestReceived(recipientId, requesterId).catch(() => {});
    return { status: "pending_sent", autoAccepted: false };
  }

  if (outgoing?.status === "PENDING") {
    serviceError("Connection request already sent.", 400, "REQUEST_PENDING");
  }

  await MemberConnection.create({
    requesterUserId: requesterId,
    recipientUserId: recipientId,
    status: "PENDING",
    attemptCount: 1
  } as any);
  void notifyConnectionRequestReceived(recipientId, requesterId).catch(() => {});
  return { status: "pending_sent", autoAccepted: false };
}

export async function acceptRequest(
  recipientId: number,
  requesterId: number
): Promise<{ status: RelationshipStatus }> {
  await assertEligibleUsers(recipientId, requesterId);
  const row = await MemberConnection.findOne({
    where: {
      requesterUserId: requesterId,
      recipientUserId: recipientId,
      status: "PENDING"
    }
  });
  if (!row) serviceError("No pending request found.", 404, "REQUEST_NOT_FOUND");
  await acceptRow(row);
  void notifyConnectionRequestAccepted(requesterId, recipientId).catch(() => {});
  return { status: "connected" };
}

export async function rejectRequest(
  recipientId: number,
  requesterId: number
): Promise<{ status: RelationshipStatus }> {
  await assertEligibleUsers(recipientId, requesterId);
  const row = await MemberConnection.findOne({
    where: {
      requesterUserId: requesterId,
      recipientUserId: recipientId,
      status: "PENDING"
    }
  });
  if (!row) serviceError("No pending request found.", 404, "REQUEST_NOT_FOUND");
  await row.update({ status: "REJECTED", respondedAt: new Date() });
  return { status: "rejected" };
}

export async function cancelRequest(
  requesterId: number,
  recipientId: number
): Promise<{ status: RelationshipStatus }> {
  const row = await MemberConnection.findOne({
    where: {
      requesterUserId: requesterId,
      recipientUserId: recipientId,
      status: "PENDING"
    }
  });
  if (!row) serviceError("No pending request found.", 404, "REQUEST_NOT_FOUND");
  await row.update({ status: "CANCELLED", respondedAt: new Date() });
  return { status: "none" };
}

export async function disconnect(
  userId: number,
  otherUserId: number
): Promise<{ status: RelationshipStatus }> {
  const row = await MemberConnection.findOne({
    where: { ...pairWhere(userId, otherUserId), status: "ACCEPTED" }
  });
  if (!row) serviceError("You are not connected with this member.", 404, "NOT_CONNECTED");
  await row.update({ status: "CANCELLED", respondedAt: new Date() });
  return { status: "none" };
}

export async function listIncomingRequests(userId: number): Promise<ConnectionRequestDto[]> {
  const rows = await MemberConnection.findAll({
    where: { recipientUserId: userId, status: "PENDING" },
    order: [["createdAt", "DESC"]],
    limit: 100
  });
  const users = await toUserDtoMap(rows.map((r) => r.requesterUserId));
  const result: ConnectionRequestDto[] = [];
  for (const row of rows) {
    const user = users.get(row.requesterUserId);
    if (!user) continue;
    result.push({
      id: row.id,
      user,
      createdAt: row.createdAt.toISOString()
    });
  }
  return result;
}

export async function listConnections(userId: number): Promise<ConnectionRequestDto[]> {
  const rows = await MemberConnection.findAll({
    where: {
      status: "ACCEPTED",
      [Op.or]: [{ requesterUserId: userId }, { recipientUserId: userId }]
    },
    order: [["updatedAt", "DESC"]],
    limit: 200
  });
  const otherIds = rows.map((row) =>
    row.requesterUserId === userId ? row.recipientUserId : row.requesterUserId
  );
  const users = await toUserDtoMap(otherIds);
  const result: ConnectionRequestDto[] = [];
  for (const row of rows) {
    const otherId =
      row.requesterUserId === userId ? row.recipientUserId : row.requesterUserId;
    const user = users.get(otherId);
    if (!user) continue;
    result.push({
      id: row.id,
      user,
      createdAt: row.updatedAt.toISOString()
    });
  }
  return result;
}

export async function getIncomingRequestCount(userId: number): Promise<number> {
  return MemberConnection.count({
    where: { recipientUserId: userId, status: "PENDING" }
  });
}

export async function severConnectionWorkflow(userA: number, userB: number): Promise<void> {
  const rows = await MemberConnection.findAll({
    where: pairWhere(userA, userB)
  });
  const now = new Date();
  for (const row of rows) {
    if (row.status === "PENDING" || row.status === "ACCEPTED") {
      await row.update({ status: "CANCELLED", respondedAt: now });
    }
  }
}

export const connectionService = {
  severConnectionWorkflow,
  getRelationshipStatus,
  getRelationshipStatusMap,
  hasAcceptedConnection,
  sendRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  disconnect,
  listIncomingRequests,
  listConnections,
  getIncomingRequestCount
};
