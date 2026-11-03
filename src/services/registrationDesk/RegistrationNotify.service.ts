/**
 * Registration desk email.
 * Rows are saved first. SMTP runs after that, outside any request transaction.
 * No cron: a failed or interrupted send stays PENDING and is picked up the next
 * time a registration is submitted or an admin opens the desk.
 * Registration itself never fails because mail failed.
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/db";
import { sendMail } from "../../utils/sendMail";
import { registrationNotifyKey, normalizeNotifyEmail, reassignmentMailCopy } from "./registrationDesk.logic";

const MAX_ATTEMPTS = 3;
const BATCH = 8;
const MAX_BATCHES_PER_KICK = 3;

type NotifyType =
  | "REGISTRATION_RECEIVED"
  | "REGISTRATION_RESUBMITTED"
  | "ASSIGNED"
  | "REASSIGNED"
  | "REASSIGNED_TO_YOU"
  | "REASSIGNED_AWAY"
  | "REASSIGNED_NOTICE"
  | "APPROVED"
  | "REJECTED";

type LogRow = {
  id: number;
  userId: number;
  recipientEmail: string;
  notificationType: NotifyType;
  idempotencyKey: string;
  attempts: number;
};

type Applicant = {
  id: number;
  fullName: string;
  email: string;
  mobile: string | null;
  status: string;
  createdAt: Date;
};

let draining = false;
let kickAgain = false;

function httpSafe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}

function dashboardUrl(userId: number): string {
  const base = (process.env.ADMIN_DASHBOARD_URL || "https://konguvettuvagounder.com/admin").replace(
    /\/$/,
    ""
  );
  return `${base}/registration-requests/${userId}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function adminRecipientEmails(): Promise<string[]> {
  const fromEnv = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => normalizeNotifyEmail(e))
    .filter((e): e is string => Boolean(e));
  let fromDb: string[] = [];
  try {
    const rows = await sequelize.query<{ email: string }>(
      `SELECT email FROM admin_users WHERE is_active = 1`,
      { type: QueryTypes.SELECT }
    );
    fromDb = rows
      .map((r) => normalizeNotifyEmail(r.email))
      .filter((e): e is string => Boolean(e));
  } catch {
    fromDb = [];
  }
  return [...new Set([...fromEnv, ...fromDb])];
}

async function activeSupportEmails(): Promise<string[]> {
  const rows = await sequelize.query<{ email: string }>(
    `SELECT email FROM support_team_members WHERE isActive = 1 AND removedAt IS NULL`,
    { type: QueryTypes.SELECT }
  );
  return rows
    .map((r) => normalizeNotifyEmail(r.email))
    .filter((e): e is string => Boolean(e));
}

async function insertLogs(
  userId: number,
  type: NotifyType,
  emails: string[],
  eventId?: number
): Promise<void> {
  const unique = [...new Set(emails)];
  for (const email of unique) {
    const key = registrationNotifyKey(type, userId, email, eventId);
    await sequelize.query(
      `INSERT IGNORE INTO registration_notification_logs
        (userId, recipientEmail, notificationType, idempotencyKey, deliveryStatus, attempts, createdAt, updatedAt)
       VALUES (:userId, :email, :type, :key, 'PENDING', 0, NOW(3), NOW(3))`,
      { replacements: { userId, email, type, key } }
    );
  }
}

export async function enqueueRegistrationReceived(userId: number): Promise<void> {
  try {
    const emails = [...new Set([...(await adminRecipientEmails()), ...(await activeSupportEmails())])];
    if (emails.length === 0) return;
    await insertLogs(userId, "REGISTRATION_RECEIVED", emails);
    kickRegistrationMailDrain();
  } catch (err) {
    console.error("[registration-notify] enqueue received failed:", httpSafe(err));
  }
}

/** After the member fixes requested fields and submits again. One mail per resubmit. */
export async function enqueueRegistrationResubmitted(
  userId: number,
  resubmittedAtMs: number
): Promise<void> {
  try {
    const emails = [...new Set([...(await adminRecipientEmails()), ...(await activeSupportEmails())])];
    if (emails.length === 0) return;
    await insertLogs(userId, "REGISTRATION_RESUBMITTED", emails, resubmittedAtMs);
    kickRegistrationMailDrain();
  } catch (err) {
    console.error("[registration-notify] enqueue resubmit failed:", httpSafe(err));
  }
}

export async function enqueueAssignmentMail(
  userId: number,
  type: "ASSIGNED" | "REASSIGNED",
  eventId: number,
  assigneeEmail: string,
  previousEmail?: string | null
): Promise<void> {
  try {
    const assignee = normalizeNotifyEmail(assigneeEmail);
    if (type === "ASSIGNED") {
      if (!assignee) return;
      await insertLogs(userId, "ASSIGNED", [assignee], eventId);
      kickRegistrationMailDrain();
      return;
    }
    const previous = previousEmail ? normalizeNotifyEmail(previousEmail) : null;
    const admins = await adminRecipientEmails();
    const toYou = assignee ? [assignee] : [];
    const away = previous && previous !== assignee ? [previous] : [];
    const notice = admins.filter((email) => email !== assignee && !away.includes(email));
    if (toYou.length) await insertLogs(userId, "REASSIGNED_TO_YOU", toYou, eventId);
    if (away.length) await insertLogs(userId, "REASSIGNED_AWAY", away, eventId);
    if (notice.length) await insertLogs(userId, "REASSIGNED_NOTICE", notice, eventId);
    if (toYou.length || away.length || notice.length) kickRegistrationMailDrain();
  } catch (err) {
    console.error("[registration-notify] enqueue assignment failed:", httpSafe(err));
  }
}

export async function enqueueRegistrationDecision(
  userId: number,
  type: "APPROVED" | "REJECTED"
): Promise<void> {
  try {
    const admins = await adminRecipientEmails();
    const assigned = await sequelize.query<{ email: string }>(
      `SELECT m.email AS email
       FROM registration_request_assignments a
       INNER JOIN support_team_members m ON m.id = a.assignedMemberId
       WHERE a.userId = :userId AND m.removedAt IS NULL
       LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    const assignee = assigned[0] ? normalizeNotifyEmail(assigned[0].email) : null;
    const emails = [...new Set([...(assignee ? [assignee] : []), ...admins])];
    if (emails.length === 0) return;
    await insertLogs(userId, type, emails);
    kickRegistrationMailDrain();
  } catch (err) {
    console.error("[registration-notify] enqueue decision failed:", httpSafe(err));
  }
}

export function kickRegistrationMailDrain(): void {
  if (draining) {
    kickAgain = true;
    return;
  }
  draining = true;
  void runDrain().finally(() => {
    draining = false;
  });
}

async function runDrain(): Promise<void> {
  try {
    let batches = 0;
    do {
      kickAgain = false;
      const sent = await drainBatch();
      batches += 1;
      if (sent === 0) break;
    } while ((kickAgain || batches < MAX_BATCHES_PER_KICK) && batches < MAX_BATCHES_PER_KICK);
  } catch (err) {
    console.error("[registration-notify] drain failed:", httpSafe(err));
  }
}

async function drainBatch(): Promise<number> {
  await sequelize.query(
    `UPDATE registration_notification_logs
     SET deliveryStatus = IF(attempts >= :maxAttempts, 'FAILED', 'PENDING'),
         updatedAt = NOW(3)
     WHERE deliveryStatus = 'SENDING'
       AND updatedAt < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)`,
    { replacements: { maxAttempts: MAX_ATTEMPTS } }
  );

  const pending = await sequelize.query<LogRow>(
    `SELECT id, userId, recipientEmail, notificationType, idempotencyKey, attempts
     FROM registration_notification_logs
     WHERE deliveryStatus = 'PENDING' AND attempts < :maxAttempts
     ORDER BY id ASC
     LIMIT ${BATCH}`,
    { replacements: { maxAttempts: MAX_ATTEMPTS }, type: QueryTypes.SELECT }
  );

  let handled = 0;
  for (const row of pending) {
    const claimed = await sequelize.query(
      `UPDATE registration_notification_logs
       SET deliveryStatus = 'SENDING', attempts = attempts + 1, updatedAt = NOW(3)
       WHERE id = :id AND deliveryStatus = 'PENDING' AND attempts < :maxAttempts`,
      { replacements: { id: row.id, maxAttempts: MAX_ATTEMPTS } }
    );
    const affected = Number((claimed[1] as { affectedRows?: number })?.affectedRows ?? 0);
    if (affected !== 1) continue;
    handled += 1;
    await deliverOne(row);
  }
  return handled;
}

async function deliverOne(row: LogRow): Promise<void> {
  try {
    const applicant = await loadApplicant(row.userId);
    if (!applicant) {
      await mark(row.id, "FAILED", "Applicant no longer exists");
      return;
    }
    const move = await loadReassignmentNames(row);
    const mail = buildMail(row.notificationType, applicant, move);
    const result = await sendMail({
      to: row.recipientEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      emailType: `registration_desk_${row.notificationType.toLowerCase()}`
    });
    if (!result.success) {
      await markRetry(row, result.error);
      return;
    }
    await sequelize.query(
      `UPDATE registration_notification_logs
       SET deliveryStatus = 'SENT', sentAt = NOW(3), lastError = NULL, updatedAt = NOW(3)
       WHERE id = :id`,
      { replacements: { id: row.id } }
    );
  } catch (err) {
    await markRetry(row, httpSafe(err));
  }
}

async function markRetry(row: LogRow, reason: string): Promise<void> {
  const attemptsNow = row.attempts + 1;
  await mark(row.id, attemptsNow >= MAX_ATTEMPTS ? "FAILED" : "PENDING", reason);
}

async function mark(id: number, status: "PENDING" | "FAILED", reason: string): Promise<void> {
  await sequelize.query(
    `UPDATE registration_notification_logs
     SET deliveryStatus = :status, lastError = :reason, updatedAt = NOW(3)
     WHERE id = :id`,
    { replacements: { id, status, reason: reason.slice(0, 500) } }
  );
}

async function loadApplicant(userId: number): Promise<Applicant | null> {
  const rows = await sequelize.query<Applicant>(
    `SELECT id, fullName, email, mobile, status, createdAt
     FROM users WHERE id = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows[0] ?? null;
}

function eventIdFromKey(key: string): number | null {
  const parts = key.split(":");
  if (parts.length < 4) return null;
  const id = Number(parts[2]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function loadReassignmentNames(
  row: LogRow
): Promise<{ toName: string; fromName: string | null } | null> {
  if (
    row.notificationType !== "REASSIGNED" &&
    row.notificationType !== "REASSIGNED_TO_YOU" &&
    row.notificationType !== "REASSIGNED_AWAY" &&
    row.notificationType !== "REASSIGNED_NOTICE"
  ) {
    return null;
  }
  const eventId = eventIdFromKey(row.idempotencyKey);
  if (!eventId) return { toName: "another support member", fromName: null };
  const rows = await sequelize.query<{
    fromMemberEmail: string | null;
    toMemberEmail: string | null;
    fromName: string | null;
    toName: string | null;
  }>(
    `SELECT e.fromMemberEmail, e.toMemberEmail, fm.name AS fromName, tm.name AS toName
     FROM registration_assignment_events e
     LEFT JOIN support_team_members fm ON fm.id = e.fromMemberId
     LEFT JOIN support_team_members tm ON tm.id = e.toMemberId
     WHERE e.id = :id
     LIMIT 1`,
    { replacements: { id: eventId }, type: QueryTypes.SELECT }
  );
  const found = rows[0];
  if (!found) return { toName: "another support member", fromName: null };
  return {
    toName: found.toName?.trim() || found.toMemberEmail || "another support member",
    fromName: found.fromName?.trim() || found.fromMemberEmail || null
  };
}

function buildMail(
  type: NotifyType,
  user: Applicant,
  move?: { toName: string; fromName: string | null } | null
): { subject: string; text: string; html: string } {
  const when = new Date(user.createdAt).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const link = dashboardUrl(user.id);
  const reassignKind =
    type === "REASSIGNED_TO_YOU"
      ? "to_you"
      : type === "REASSIGNED_AWAY"
        ? "away"
        : type === "REASSIGNED" || type === "REASSIGNED_NOTICE"
          ? "notice"
          : null;
  const reassignCopy = reassignKind
    ? reassignmentMailCopy({
        kind: reassignKind,
        requestId: user.id,
        toName: move?.toName || "another support member",
        fromName: move?.fromName
      })
    : null;
  const subjectByType: Record<NotifyType, string> = {
    REGISTRATION_RECEIVED: "[DigitalHouse] New Registration Request Received",
    REGISTRATION_RESUBMITTED: `[DigitalHouse] Registration Request #${user.id} resubmitted`,
    ASSIGNED: `[DigitalHouse] Registration Request #${user.id} assigned to you`,
    REASSIGNED: reassignCopy?.subject ?? `[DigitalHouse] Registration Request #${user.id} reassigned`,
    REASSIGNED_TO_YOU: reassignCopy?.subject ?? "",
    REASSIGNED_AWAY: reassignCopy?.subject ?? "",
    REASSIGNED_NOTICE: reassignCopy?.subject ?? "",
    APPROVED: `[DigitalHouse] Registration Request #${user.id} approved`,
    REJECTED: `[DigitalHouse] Registration Request #${user.id} rejected`
  };
  const intro: Record<NotifyType, string> = {
    REGISTRATION_RECEIVED: "A new member submitted a registration request.",
    REGISTRATION_RESUBMITTED:
      "The member updated the requested details and submitted the registration again.",
    ASSIGNED: "A registration request has been assigned to you.",
    REASSIGNED: reassignCopy?.intro ?? "A registration request was reassigned.",
    REASSIGNED_TO_YOU: reassignCopy?.intro ?? "",
    REASSIGNED_AWAY: reassignCopy?.intro ?? "",
    REASSIGNED_NOTICE: reassignCopy?.intro ?? "",
    APPROVED: "A registration request was approved.",
    REJECTED: "A registration request was rejected."
  };
  const lines = [
    intro[type],
    "",
    `Request ID: ${user.id}`,
    `Name: ${user.fullName}`,
    `Email: ${user.email}`,
    `Mobile: ${user.mobile || "—"}`,
    `Submitted: ${when}`,
    `Status: ${user.status}`,
    "",
    `Open in admin: ${link}`
  ];
  const safe = {
    intro: escapeHtml(intro[type]),
    name: escapeHtml(user.fullName || ""),
    email: escapeHtml(user.email || ""),
    mobile: escapeHtml(user.mobile || "—"),
    status: escapeHtml(user.status || ""),
    when: escapeHtml(when),
    link: escapeHtml(link)
  };
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#23201c;max-width:560px;margin:0 auto;padding:24px">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:.04em;color:#128a3c;font-weight:700">DIGITAL HOUSE</p>
    <p style="margin:0 0 16px">${safe.intro}</p>
    <table style="width:100%;border-collapse:collapse;background:#f4f7f4;border-radius:8px">
      <tr><td style="padding:8px 12px;color:#6b645a;width:140px">Request ID</td><td style="padding:8px 12px;font-weight:700">#${user.id}</td></tr>
      <tr><td style="padding:8px 12px;color:#6b645a">Name</td><td style="padding:8px 12px">${safe.name}</td></tr>
      <tr><td style="padding:8px 12px;color:#6b645a">Email</td><td style="padding:8px 12px">${safe.email}</td></tr>
      <tr><td style="padding:8px 12px;color:#6b645a">Mobile</td><td style="padding:8px 12px">${safe.mobile}</td></tr>
      <tr><td style="padding:8px 12px;color:#6b645a">Submitted</td><td style="padding:8px 12px">${safe.when}</td></tr>
      <tr><td style="padding:8px 12px;color:#6b645a">Status</td><td style="padding:8px 12px">${safe.status}</td></tr>
    </table>
    <p style="margin:20px 0 0">
      <a href="${safe.link}" style="display:inline-block;background:#128a3c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">Open request</a>
    </p>
  </div>`.trim();
  return { subject: subjectByType[type], text: lines.join("\n"), html };
}
