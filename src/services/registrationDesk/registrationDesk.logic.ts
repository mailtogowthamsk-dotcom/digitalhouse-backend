/** Pure helpers for the registration desk. No database access. */

export type RegistrationWorkflow = "NEW" | "ASSIGNED" | "IN_PROGRESS";

export type RegistrationDeskStatus =
  | "NEW"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

const REVIEWABLE = new Set(["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED"]);

export function isReviewableUserStatus(status: string | null | undefined): boolean {
  return REVIEWABLE.has(String(status || ""));
}

export function displayRegistrationStatus(input: {
  userStatus: string;
  workflowStatus?: RegistrationWorkflow | null;
  assignedMemberId?: number | null;
}): RegistrationDeskStatus {
  if (input.userStatus === "APPROVED") return "APPROVED";
  if (input.userStatus === "REJECTED") return "REJECTED";
  if (input.userStatus === "SUSPENDED") return "SUSPENDED";
  if (input.userStatus === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (input.workflowStatus === "IN_PROGRESS" && input.assignedMemberId) return "IN_PROGRESS";
  if (input.assignedMemberId) return "ASSIGNED";
  return "NEW";
}

export function registrationNotifyKey(
  type: string,
  userId: number,
  email: string,
  eventId?: number
): string {
  const to = email.trim().toLowerCase();
  if (type === "REGISTRATION_RECEIVED" || type === "APPROVED" || type === "REJECTED") {
    return `${type}:${userId}:${to}`;
  }
  return `${type}:${userId}:${eventId ?? 0}:${to}`;
}

export type ReassignMailKind = "to_you" | "away" | "notice";

/** Different sentence for the new assignee, the previous assignee, and other admins. */
export function reassignmentMailCopy(input: {
  kind: ReassignMailKind;
  requestId: number;
  toName: string;
  fromName?: string | null;
}): { subject: string; intro: string } {
  const toName = input.toName.trim() || "another support member";
  const fromName = input.fromName?.trim() || "";
  if (input.kind === "to_you") {
    return {
      subject: `[DigitalHouse] Registration Request #${input.requestId} reassigned to you`,
      intro: "This registration request has been reassigned to you."
    };
  }
  if (input.kind === "away") {
    return {
      subject: `[DigitalHouse] Registration Request #${input.requestId} reassigned to ${toName}`,
      intro: `This registration request is no longer assigned to you. It was reassigned to ${toName}.`
    };
  }
  const intro = fromName
    ? `This registration request was reassigned from ${fromName} to ${toName}.`
    : `This registration request was reassigned to ${toName}.`;
  return {
    subject: `[DigitalHouse] Registration Request #${input.requestId} reassigned to ${toName}`,
    intro
  };
}

export function sanitizeSupportNote(raw: string): string {
  const trimmed = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  const noTags = trimmed.replace(/[<>]/g, "");
  return noTags.slice(0, 2000);
}

export function normalizeNotifyEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 191) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
