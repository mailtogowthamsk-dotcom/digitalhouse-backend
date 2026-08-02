import { User, PendingProfileUpdate, MatrimonyRequestMeta } from "../../models";
import { computeMatrimonyCompletion } from "../MatrimonyCompletion.service";
import { writeAudit } from "../MatrimonyAudit.service";
import { computeFieldChanges } from "../../utils/matrimonyChanges.util";
import {
  isMatrimonyForSelf,
  resolveCandidatePhotoUrl,
  syncMatrimonyPhotoFields,
  validateCandidatePhotoRules
} from "../../constants/matrimony-photo.constants";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "../Profile.service";
import type { MatrimonyHubResponse } from "./matrimony.types";
import {
  SUBMITTED_FLAG,
  SUBMISSION_SNAPSHOT_KEY,
  RESUB_COUNT_KEY
} from "./matrimony.types";
import {
  markMatrimonyMediaAttached,
  normalizeHoroscopeWrite,
  stripInternalKeys,
  readRawPendingData,
  upsertMatrimonyPending,
  queueMatrimonyReReviewIfNeeded,
  loadMeta,
  findActiveMatrimonyApplication
} from "./matrimony.persistence.service";
import { getMatrimonyHub, getUserContext } from "./matrimony.hub.service";

/** Save draft (not visible in admin queue until submit) */
export async function saveMatrimonyDraft(
  userId: number,
  payload: Record<string, unknown>
): Promise<MatrimonyHubResponse> {
  const hub = await getMatrimonyHub(userId);
  if (hub.status === "PENDING" || hub.status === "RESUBMITTED") {
    const err = new Error("Your profile is under admin review. Wait for approval or requested changes.");
    (err as any).status = 400;
    throw err;
  }

  const ctx = await getUserContext(userId);
  // Prefer draft over approved so in-progress edits are the merge base.
  const base: Record<string, unknown> = {
    ...((hub.approved ?? {}) as Record<string, unknown>),
    ...((hub.draft ?? {}) as Record<string, unknown>)
  };
  // Null in a partial draft save must not wipe values already stored (e.g. fatherName).
  const incoming: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null && base[k] != null && base[k] !== "") continue;
    incoming[k] = v;
  }
  normalizeHoroscopeWrite(incoming, base);
  const merged = syncMatrimonyPhotoFields({
    ...base,
    ...incoming,
    kulamSnapshot: (payload.kulamSnapshot as string | null | undefined) ?? (base.kulamSnapshot as string | null | undefined) ?? ctx.kulam ?? null
  });
  await upsertMatrimonyPending(userId, merged, false);
  await markMatrimonyMediaAttached(userId, merged);
  return getMatrimonyHub(userId);
}

/** Validate completion and queue for admin review (initial or resubmission) */
export async function submitMatrimonyProfile(
  userId: number,
  optionalPayload?: Record<string, unknown>
): Promise<MatrimonyHubResponse> {
  const timingOn = process.env.MATRIMONY_SUBMIT_TIMING === "true";
  const tSubmit = Date.now();
  const marks: Array<{ step: string; ms: number }> = [];
  const mark = (step: string, since: number) => {
    const ms = Date.now() - since;
    marks.push({ step, ms });
    if (timingOn) console.log(`[matrimony-submit] user=${userId} ${step}=${ms}ms`);
  };

  let t = Date.now();
  // One pending lookup shared by hub status checks + upsert (avoids 2–3 identical findOnes).
  const preloadedActive = await findActiveMatrimonyApplication(userId);
  mark("findActiveMatrimonyApplication", t);

  t = Date.now();
  const hub = await getMatrimonyHub(userId, { preloadedActive });
  mark("getMatrimonyHub", t);

  if (hub.status === "PENDING") {
    return {
      ...hub,
      message: "Your profile is already under admin review."
    } as MatrimonyHubResponse & { message?: string };
  }
  if (hub.status === "RESUBMITTED") {
    return {
      ...hub,
      message: "Your corrected profile is already resubmitted and awaiting review."
    } as MatrimonyHubResponse & { message?: string };
  }

  t = Date.now();
  const ctx = hub.user_context;
  const accountRow = await User.findByPk(userId, {
    attributes: ["profilePhoto", "signupProvider", "googleId"]
  });
  const accountPhotoRaw = accountRow?.profilePhoto?.trim() || null;
  mark("loadAccountPhoto", t);

  const incoming = { ...(optionalPayload ?? {}) };
  normalizeHoroscopeWrite(incoming, (hub.draft ?? {}) as Record<string, unknown>);
  let merged: Record<string, unknown> = syncMatrimonyPhotoFields({
    ...(hub.draft ?? {}),
    ...incoming,
    matrimonyProfileActive: true,
    kulamSnapshot: optionalPayload?.kulamSnapshot ?? hub.draft?.kulamSnapshot ?? ctx.kulam ?? null
  });

  if (
    isMatrimonyForSelf(merged.lookingFor) &&
    merged.useAccountProfilePhoto === true &&
    !resolveCandidatePhotoUrl(merged) &&
    accountPhotoRaw
  ) {
    merged.candidatePhotoUrl = accountPhotoRaw;
    merged = syncMatrimonyPhotoFields(merged);
  }

  const photoCheck = validateCandidatePhotoRules(merged, accountPhotoRaw);
  if (!photoCheck.ok) {
    const err = new Error(photoCheck.message ?? "Matrimony candidate photo required");
    (err as any).status = 400;
    throw err;
  }

  const isResubmission = hub.status === "CHANGES_REQUESTED";
  const requestedFields = hub.pending?.requested_fields ?? null;

  const { missing } = computeMatrimonyCompletion(
    null,
    stripInternalKeys(merged),
    ctx.profile_image,
    isResubmission ? requestedFields : null
  );

  if (missing.length > 0) {
    const err = new Error(
      isResubmission
        ? `Please update the requested sections: ${missing.join(", ")}`
        : `Complete all required fields before submit: ${missing.join(", ")}`
    );
    (err as any).status = 400;
    (err as any).missing = missing;
    throw err;
  }

  if (merged.partnerAgeMin != null && merged.partnerAgeMax != null) {
    if (Number(merged.partnerAgeMin) > Number(merged.partnerAgeMax)) {
      const err = new Error("Partner age minimum cannot exceed maximum.");
      (err as any).status = 400;
      throw err;
    }
  }

  t = Date.now();
  const row = await upsertMatrimonyPending(userId, merged, true, {
    existingRow: preloadedActive.row
  });
  mark("upsertMatrimonyPending", t);

  t = Date.now();
  await markMatrimonyMediaAttached(userId, merged);
  mark("markMatrimonyMediaAttached", t);

  const rawFull = readRawPendingData(row.data);
  const profileData = stripInternalKeys(merged) as Record<string, unknown>;
  const priorSnapshot =
    (rawFull[SUBMISSION_SNAPSHOT_KEY] as Record<string, unknown> | undefined) ?? profileData;
  const snapshot = isResubmission ? priorSnapshot : profileData;
  const resubmissionCount = Number(rawFull[RESUB_COUNT_KEY] ?? 0) + (isResubmission ? 1 : 0);
  const changes = computeFieldChanges(snapshot, profileData);

  t = Date.now();
  await row.update({
    data: {
      ...rawFull,
      ...profileData,
      [SUBMITTED_FLAG]: true,
      [SUBMISSION_SNAPSHOT_KEY]: snapshot,
      [RESUB_COUNT_KEY]: resubmissionCount
    },
    status: "PENDING",
    submittedAt: new Date(),
    updatedAt: new Date()
  } as any);
  mark("row.update(submit)", t);

  t = Date.now();
  const meta = await loadMeta(row.id);
  if (meta) {
    try {
      await meta.update({
        workflowStatus: "UNDER_REVIEW",
        updatedAt: new Date()
      } as any);
    } catch (err) {
      console.warn("[Matrimony] meta update on submit failed:", err instanceof Error ? err.message : err);
    }
  } else {
    try {
      await MatrimonyRequestMeta.create({
        pendingUpdateId: row.id,
        userId,
        workflowStatus: "UNDER_REVIEW",
        assignedReviewer: null,
        reviewedBy: null,
        rejectionReason: null,
        rejectionComment: null,
        verification: {},
        suspended: false
      } as any);
    } catch (err) {
      console.warn("[Matrimony] meta create on submit failed:", err instanceof Error ? err.message : err);
    }
  }
  mark("meta.upsert", t);

  await writeAudit(
    userId,
    row.id,
    isResubmission ? "RESUBMITTED" : "PROFILE_SUBMITTED",
    "user",
    { changes, resubmissionCount, submittedAt: new Date().toISOString() }
  ).catch(() => {});

  if (isResubmission) {
    await row.update({ adminRemarks: null } as any);
  }

  const Notifications = await import("../Notification.service");
  void Notifications.notifyMatrimonyApplicationSubmitted(userId).catch(() => {});

  if (accountRow?.signupProvider === "GOOGLE" || accountRow?.googleId) {
    const { trackAuthEvent } = await import("../authAnalytics.service");
    void trackAuthEvent("GOOGLE_MATRIMONY_APPLY", {
      userId,
      provider: "GOOGLE",
      metadata: { isResubmission }
    });
  }

  t = Date.now();
  const result = await getMatrimonyHub(userId);
  mark("getMatrimonyHub(final)", t);

  if (timingOn || Date.now() - tSubmit >= 3000) {
    console.log(
      `[matrimony-submit] user=${userId} total=${Date.now() - tSubmit}ms marks=${JSON.stringify(marks)}`
    );
  }
  return result;
}

/**
 * Account profile photo changed — do NOT auto-copy to matrimony candidate photo
 * unless profile is for SELF and user opted in via useAccountProfilePhoto.
 */
export async function onUserProfilePhotoUpdated(userId: number, profilePhotoUrl: string | null): Promise<void> {
  const pending = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" },
    order: [["submittedAt", "DESC"]],
    attributes: ["id", "data", "status"]
  });
  if (pending) {
    const raw = readRawPendingData(pending.data);
    const data = normalizeJsonColumn(pending.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
    if (
      isMatrimonyForSelf(data.lookingFor ?? raw.lookingFor) &&
      (data.useAccountProfilePhoto === true || raw.useAccountProfilePhoto === true)
    ) {
      await queueMatrimonyReReviewIfNeeded(userId, ["candidatePhotoUrl"]);
    }
    return;
  }
}
