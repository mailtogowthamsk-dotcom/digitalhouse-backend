import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/db";
import { roleHasAction, type AdminRole } from "../../constants/adminRoles.constants";
import {
  displayRegistrationStatus,
  isReviewableUserStatus,
  sanitizeSupportNote,
  type RegistrationDeskStatus,
  type RegistrationWorkflow
} from "./registrationDesk.logic";
import { enqueueAssignmentMail, kickRegistrationMailDrain } from "./RegistrationNotify.service";
import { isPrivateR2Object, toPrivateSignedUrlIfR2, toPublicUrlIfR2 } from "../../utils/r2Client";

async function viewableProfilePhoto(url: string | null | undefined): Promise<string | null> {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  if (isPrivateR2Object(url)) return toPrivateSignedUrlIfR2(url);
  return toPublicUrlIfR2(url);
}

export type QueueFilter =
  | "all"
  | "new"
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "approved"
  | "rejected";

type ListRow = {
  id: number;
  fullName: string;
  email: string;
  mobile: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assignedMemberId: number | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  workflowStatus: RegistrationWorkflow | null;
  assignedAt: Date | null;
};

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

const SUBMITTED = `u.profile_complete = 1 AND u.status <> 'DELETED'`;

function filterSql(filter: QueueFilter): string {
  switch (filter) {
    case "new":
      return `u.status IN ('PENDING','PENDING_REVIEW') AND a.assignedMemberId IS NULL`;
    case "unassigned":
      return `u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED') AND a.assignedMemberId IS NULL`;
    case "assigned":
      return `a.workflowStatus = 'ASSIGNED' AND a.assignedMemberId IS NOT NULL AND u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED')`;
    case "in_progress":
      return `a.workflowStatus = 'IN_PROGRESS' AND u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED')`;
    case "approved":
      return `u.status = 'APPROVED'`;
    case "rejected":
      return `u.status = 'REJECTED'`;
    default:
      return `1 = 1`;
  }
}

function mapRow(row: ListRow) {
  return {
    requestId: row.id,
    applicantName: row.fullName,
    email: row.email,
    mobile: row.mobile,
    submittedAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    userStatus: row.status,
    status: displayRegistrationStatus({
      userStatus: row.status,
      workflowStatus: row.workflowStatus,
      assignedMemberId: row.assignedMemberId
    }),
    assignedMemberId: row.assignedMemberId,
    assignedTo: row.assigneeName || row.assigneeEmail || null,
    assignedAt: row.assignedAt ? new Date(row.assignedAt).toISOString() : null
  };
}

export async function registrationSummary(): Promise<{
  total: number;
  newRequests: number;
  unassigned: number;
  assigned: number;
  inProgress: number;
  approved: number;
  rejected: number;
  badge: number;
}> {
  const rows = await sequelize.query<{
    total: number;
    newRequests: number;
    unassigned: number;
    assigned: number;
    inProgress: number;
    approved: number;
    rejected: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(u.status IN ('PENDING','PENDING_REVIEW') AND a.assignedMemberId IS NULL) AS newRequests,
       SUM(u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED') AND a.assignedMemberId IS NULL) AS unassigned,
       SUM(a.workflowStatus = 'ASSIGNED' AND a.assignedMemberId IS NOT NULL AND u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED')) AS assigned,
       SUM(a.workflowStatus = 'IN_PROGRESS' AND u.status IN ('PENDING','PENDING_REVIEW','CHANGES_REQUESTED')) AS inProgress,
       SUM(u.status = 'APPROVED') AS approved,
       SUM(u.status = 'REJECTED') AS rejected
     FROM users u
     LEFT JOIN registration_request_assignments a ON a.userId = u.id
     WHERE ${SUBMITTED}`,
    { type: QueryTypes.SELECT }
  );
  const row = rows[0];
  const num = (value: number | string | null | undefined) => Number(value || 0);
  const unassigned = num(row?.unassigned);
  return {
    total: num(row?.total),
    newRequests: num(row?.newRequests),
    unassigned,
    assigned: num(row?.assigned),
    inProgress: num(row?.inProgress),
    approved: num(row?.approved),
    rejected: num(row?.rejected),
    badge: unassigned
  };
}

export async function listRegistrationRequests(input: {
  filter: QueueFilter;
  q?: string;
  page: number;
  limit: number;
  sort: "submitted" | "updated";
  dir: "asc" | "desc";
  mineEmail?: string | null;
}): Promise<{ items: ReturnType<typeof mapRow>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, input.page);
  const limit = Math.min(50, Math.max(1, input.limit));
  const offset = (page - 1) * limit;
  const where: string[] = [SUBMITTED, filterSql(input.filter)];
  const replacements: Record<string, string | number> = { limit, offset };

  const q = input.q?.trim() ?? "";
  if (q) {
    if (/^\d+$/.test(q)) {
      where.push(`u.id = :qid`);
      replacements.qid = Number(q);
    } else {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push(`(u.fullName LIKE :like OR u.email LIKE :like OR u.mobile LIKE :like)`);
      replacements.like = like;
    }
  }

  if (input.mineEmail) {
    where.push(`assignee.email = :mineEmail AND assignee.removedAt IS NULL`);
    replacements.mineEmail = input.mineEmail;
  }

  const whereSql = where.join(" AND ");
  const orderCol = input.sort === "updated" ? "u.updatedAt" : "u.createdAt";
  const dir = input.dir === "asc" ? "ASC" : "DESC";

  const countRows = await sequelize.query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM users u
     LEFT JOIN registration_request_assignments a ON a.userId = u.id
     LEFT JOIN support_team_members assignee ON assignee.id = a.assignedMemberId
     WHERE ${whereSql}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const items = await sequelize.query<ListRow>(
    `SELECT
       u.id, u.fullName, u.email, u.mobile, u.status, u.createdAt, u.updatedAt,
       a.assignedMemberId, a.workflowStatus, a.assignedAt,
       assignee.name AS assigneeName, assignee.email AS assigneeEmail
     FROM users u
     LEFT JOIN registration_request_assignments a ON a.userId = u.id
     LEFT JOIN support_team_members assignee ON assignee.id = a.assignedMemberId
     WHERE ${whereSql}
     ORDER BY ${orderCol} ${dir}, u.id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );

  kickRegistrationMailDrain();
  return {
    items: items.map(mapRow),
    total: Number(countRows[0]?.total || 0),
    page,
    limit
  };
}

type Actor = { email: string; role: AdminRole };

async function activeMemberByEmail(email: string): Promise<{ id: number; name: string | null; email: string } | null> {
  const rows = await sequelize.query<{ id: number; name: string | null; email: string }>(
    `SELECT id, name, email FROM support_team_members
     WHERE email = :email AND isActive = 1 AND removedAt IS NULL
     LIMIT 1`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  return rows[0] ?? null;
}

function canReassign(role: AdminRole): boolean {
  if (role === "MODERATOR") return false;
  return roleHasAction(role, "users.approve") || roleHasAction(role, "registration_requests.manage_team");
}

async function loadUserForDesk(userId: number): Promise<{
  id: number;
  fullName: string;
  email: string;
  mobile: string | null;
  status: string;
  username: string | null;
  gender: string | null;
  dob: string | null;
  location: string | null;
  district: string | null;
  kulam: string | null;
  occupation: string | null;
  profilePhoto: string | null;
  pendingProfilePhoto: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const rows = await sequelize.query<{
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
    status: string;
    username: string | null;
    gender: string | null;
    dob: string | null;
    location: string | null;
    district: string | null;
    kulam: string | null;
    occupation: string | null;
    profilePhoto: string | null;
    pendingProfilePhoto: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, fullName, email, mobile, status, username, gender, dob, location, district, kulam, occupation,
            profilePhoto, pending_profile_photo AS pendingProfilePhoto, createdAt, updatedAt
     FROM users WHERE id = :userId AND profile_complete = 1 AND status <> 'DELETED' LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows[0] ?? null;
}

export async function getRegistrationRequest(userId: number, actor: Actor) {
  const user = await loadUserForDesk(userId);
  if (!user) throw httpError("Registration request not found.", 404);
  const assignment = await sequelize.query<{
    assignedMemberId: number | null;
    workflowStatus: RegistrationWorkflow;
    assignedAt: Date | null;
    assignedBy: string | null;
    assigneeName: string | null;
    assigneeEmail: string | null;
  }>(
    `SELECT a.assignedMemberId, a.workflowStatus, a.assignedAt, a.assignedBy,
            m.name AS assigneeName, m.email AS assigneeEmail
     FROM registration_request_assignments a
     LEFT JOIN support_team_members m ON m.id = a.assignedMemberId
     WHERE a.userId = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  const current = assignment[0] ?? null;
  const status: RegistrationDeskStatus = displayRegistrationStatus({
    userStatus: user.status,
    workflowStatus: current?.workflowStatus ?? null,
    assignedMemberId: current?.assignedMemberId ?? null
  });
  const me = await activeMemberByEmail(actor.email);
  const events = await sequelize.query(
    `SELECT id, action, fromMemberEmail, toMemberEmail, actorEmail, createdAt
     FROM registration_assignment_events
     WHERE userId = :userId
     ORDER BY id DESC
     LIMIT 50`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  const notes = await sequelize.query(
    `SELECT id, authorEmail, body, createdAt
     FROM registration_internal_notes
     WHERE userId = :userId
     ORDER BY id DESC
     LIMIT 50`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  const approvals = await sequelize.query(
    `SELECT id, verifiedBy, verifiedAt, remarks
     FROM admin_verifications
     WHERE userId = :userId
     ORDER BY verifiedAt DESC
     LIMIT 20`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

  const reviewable = isReviewableUserStatus(user.status);
  const [profilePhoto, pendingProfilePhoto] = await Promise.all([
    viewableProfilePhoto(user.profilePhoto),
    viewableProfilePhoto(user.pendingProfilePhoto)
  ]);
  return {
    request: {
      ...mapRow({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        assignedMemberId: current?.assignedMemberId ?? null,
        assigneeName: current?.assigneeName ?? null,
        assigneeEmail: current?.assigneeEmail ?? null,
        workflowStatus: current?.workflowStatus ?? null,
        assignedAt: current?.assignedAt ?? null
      }),
      status,
      username: user.username,
      gender: user.gender,
      dob: user.dob,
      location: user.location,
      district: user.district,
      kulam: user.kulam,
      occupation: user.occupation,
      profilePhoto,
      pendingProfilePhoto,
      assignedBy: current?.assignedBy ?? null
    },
    events,
    notes,
    approvals,
    permissions: {
      canClaim: Boolean(me) && reviewable && !current?.assignedMemberId,
      canStart:
        reviewable &&
        current?.workflowStatus === "ASSIGNED" &&
        (current.assignedMemberId === me?.id || canReassign(actor.role)),
      canReassign: canReassign(actor.role) && reviewable,
      canNote: true,
      canApprove:
        roleHasAction(actor.role, "users.approve") &&
        reviewable &&
        (actor.role !== "MODERATOR" || Boolean(me && current?.assignedMemberId === me.id)),
      canOpenProfile:
        actor.role !== "MODERATOR" ||
        Boolean(me && current?.assignedMemberId === me.id)
    }
  };
}

async function ensureAssignmentRow(userId: number): Promise<void> {
  await sequelize.query(
    `INSERT INTO registration_request_assignments (userId, workflowStatus, updatedAt)
     VALUES (:userId, 'NEW', NOW(3))
     ON DUPLICATE KEY UPDATE userId = userId`,
    { replacements: { userId } }
  );
}

export async function claimRegistrationRequest(userId: number, actor: Actor): Promise<void> {
  const user = await loadUserForDesk(userId);
  if (!user) throw httpError("Registration request not found.", 404);
  if (!isReviewableUserStatus(user.status)) {
    throw httpError("This registration is no longer waiting for review.", 400);
  }
  const me = await activeMemberByEmail(actor.email);
  if (!me) {
    throw httpError("Only an active support team member can claim a request.", 403);
  }

  await sequelize.transaction(async (transaction) => {
    await ensureAssignmentRow(userId);
    const updated = await sequelize.query(
      `UPDATE registration_request_assignments
       SET assignedMemberId = :memberId,
           workflowStatus = 'ASSIGNED',
           assignedAt = NOW(3),
           assignedBy = :actor,
           updatedAt = NOW(3)
       WHERE userId = :userId AND assignedMemberId IS NULL AND workflowStatus = 'NEW'`,
      { replacements: { userId, memberId: me.id, actor: actor.email }, transaction }
    );
    const affected = Number((updated[1] as { affectedRows?: number })?.affectedRows ?? 0);
    if (affected !== 1) {
      const owner = await sequelize.query<{ name: string | null; email: string | null }>(
        `SELECT m.name, m.email
         FROM registration_request_assignments a
         LEFT JOIN support_team_members m ON m.id = a.assignedMemberId
         WHERE a.userId = :userId LIMIT 1`,
        { replacements: { userId }, type: QueryTypes.SELECT, transaction }
      );
      const who = owner[0]?.name || owner[0]?.email || "another member";
      throw httpError(`Already claimed by ${who}.`, 409);
    }
    await sequelize.query(
      `INSERT INTO registration_assignment_events
        (userId, action, toMemberId, toMemberEmail, actorEmail, createdAt)
       VALUES (:userId, 'CLAIM', :memberId, :email, :actor, NOW(3))`,
      { replacements: { userId, memberId: me.id, email: me.email, actor: actor.email }, transaction }
    );
  });

  const event = await sequelize.query<{ id: number }>(
    `SELECT id FROM registration_assignment_events
     WHERE userId = :userId AND action = 'CLAIM'
     ORDER BY id DESC LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  if (event[0]) void enqueueAssignmentMail(userId, "ASSIGNED", event[0].id, me.email);
}

export async function reassignRegistrationRequest(
  userId: number,
  memberId: number,
  actor: Actor
): Promise<void> {
  if (!canReassign(actor.role)) throw httpError("You cannot reassign requests.", 403);
  const user = await loadUserForDesk(userId);
  if (!user) throw httpError("Registration request not found.", 404);
  if (!isReviewableUserStatus(user.status)) {
    throw httpError("This registration is no longer waiting for review.", 400);
  }
  const member = await sequelize.query<{ id: number; email: string }>(
    `SELECT id, email FROM support_team_members
     WHERE id = :memberId AND isActive = 1 AND removedAt IS NULL LIMIT 1`,
    { replacements: { memberId }, type: QueryTypes.SELECT }
  );
  if (!member[0]) throw httpError("Choose an active support member.", 400);

  let eventId = 0;
  let previousEmail: string | null = null;
  let sameMember = false;
  await sequelize.transaction(async (transaction) => {
    await ensureAssignmentRow(userId);
    const current = await sequelize.query<{ assignedMemberId: number | null; email: string | null }>(
      `SELECT a.assignedMemberId, m.email
       FROM registration_request_assignments a
       LEFT JOIN support_team_members m ON m.id = a.assignedMemberId
       WHERE a.userId = :userId LIMIT 1 FOR UPDATE`,
      { replacements: { userId }, type: QueryTypes.SELECT, transaction }
    );
    previousEmail = current[0]?.email ?? null;
    sameMember = current[0]?.assignedMemberId === memberId;
    await sequelize.query(
      `UPDATE registration_request_assignments
       SET assignedMemberId = :memberId,
           workflowStatus = 'ASSIGNED',
           assignedAt = NOW(3),
           assignedBy = :actor,
           updatedAt = NOW(3)
       WHERE userId = :userId`,
      { replacements: { userId, memberId, actor: actor.email }, transaction }
    );
    await sequelize.query(
      `INSERT INTO registration_assignment_events
        (userId, action, fromMemberId, toMemberId, fromMemberEmail, toMemberEmail, actorEmail, createdAt)
       VALUES (:userId, 'REASSIGN', :fromId, :toId, :fromEmail, :toEmail, :actor, NOW(3))`,
      {
        replacements: {
          userId,
          fromId: current[0]?.assignedMemberId ?? null,
          toId: memberId,
          fromEmail: current[0]?.email ?? null,
          toEmail: member[0]!.email,
          actor: actor.email
        },
        transaction
      }
    );
    const inserted = await sequelize.query<{ id: number }>(
      `SELECT LAST_INSERT_ID() AS id`,
      { type: QueryTypes.SELECT, transaction }
    );
    eventId = Number(inserted[0]?.id ?? 0);
  });
  if (eventId && !sameMember) {
    void enqueueAssignmentMail(userId, "REASSIGNED", eventId, member[0]!.email, previousEmail);
  }
}

export async function startRegistrationReview(userId: number, actor: Actor): Promise<void> {
  const user = await loadUserForDesk(userId);
  if (!user) throw httpError("Registration request not found.", 404);
  if (!isReviewableUserStatus(user.status)) {
    throw httpError("This registration is no longer waiting for review.", 400);
  }
  const me = await activeMemberByEmail(actor.email);
  const updated = await sequelize.query(
    `UPDATE registration_request_assignments
     SET workflowStatus = 'IN_PROGRESS', updatedAt = NOW(3)
     WHERE userId = :userId
       AND workflowStatus = 'ASSIGNED'
       AND assignedMemberId IS NOT NULL
       AND (:canOverride = 1 OR assignedMemberId = :memberId)`,
    {
      replacements: {
        userId,
        memberId: me?.id ?? 0,
        canOverride: canReassign(actor.role) ? 1 : 0
      }
    }
  );
  const affected = Number((updated[1] as { affectedRows?: number })?.affectedRows ?? 0);
  if (affected !== 1) {
    throw httpError("Only the assigned member can start this review.", 403);
  }
  await sequelize.query(
    `INSERT INTO registration_assignment_events (userId, action, actorEmail, createdAt)
     VALUES (:userId, 'START_REVIEW', :actor, NOW(3))`,
    { replacements: { userId, actor: actor.email } }
  );
}

export async function addRegistrationNote(userId: number, body: string, actor: Actor): Promise<void> {
  const user = await loadUserForDesk(userId);
  if (!user) throw httpError("Registration request not found.", 404);
  const note = sanitizeSupportNote(body);
  if (!note) throw httpError("Write a note first.", 400);
  await sequelize.query(
    `INSERT INTO registration_internal_notes (userId, authorEmail, body, createdAt)
     VALUES (:userId, :actor, :body, NOW(3))`,
    { replacements: { userId, actor: actor.email, body: note } }
  );
}
