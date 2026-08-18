import { User, UserProfile } from "../../models";
import type { MatrimonySection } from "../../models/UserProfile.model";
import type { MatrimonyChangeRequestInfo } from "../../models/MatrimonyRequestMeta.model";
import { fieldsForChangeSections } from "../../constants/matrimony-changes.constants";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "../Profile.service";
import { toPublicUrlIfR2 } from "../../utils/r2Client";
import { computeMatrimonyCompletion } from "../MatrimonyCompletion.service";
import {
  isMatrimonyForSelf,
  resolveCandidatePhotoUrl
} from "../../constants/matrimony-photo.constants";
import { normalizeMatrimonyLifecycle } from "../../constants/matrimony-lifecycle.constants";
import { resolveMatrimonyCandidate } from "../../utils/matrimonyCandidate.util";
import type { MatrimonyHubResponse, MatrimonyHubStatus } from "./matrimony.types";
import {
  CHANGE_REQUEST_KEY,
  RESUB_COUNT_KEY
} from "./matrimony.types";
import {
  signMatrimonySection,
  stripInternalKeys,
  readRawPendingData,
  isSubmittedPendingData,
  findActiveMatrimonyApplication,
  loadMeta
} from "./matrimony.persistence.service";

/** Browse unlocks only after admin-approved profile is 100% complete and photo is usable. */
export function resolveMatrimonyCanBrowse(input: {
  hasApproved: boolean;
  status: MatrimonyHubStatus;
  completionPercentage: number;
  approved: MatrimonySection | Record<string, unknown> | null;
}): boolean {
  const { hasApproved, status, completionPercentage, approved } = input;
  if (!hasApproved) return false;
  // Closed profiles must reactivate before browsing; paused can still browse.
  if (status === "CLOSED") return false;
  if (status !== "APPROVED" && status !== "PAUSED") return false;
  if (completionPercentage < 100) return false;
  const section = (approved ?? {}) as MatrimonySection;
  if (section.matrimonySuspended === true) return false;
  const photo = resolveCandidatePhotoUrl(section as Record<string, unknown>);
  if (!photo) return false;
  const photoStatus = section.candidatePhotoStatus;
  if (photoStatus === "REJECTED" || photoStatus === "REUPLOAD_REQUESTED") return false;
  return true;
}

export function matrimonyBrowseBlockedMessage(
  hub: Pick<MatrimonyHubResponse, "status" | "completion_percentage" | "can_browse">
): string {
  if (hub.can_browse) return "";
  if (hub.status === "PAUSED") {
    return "Your matrimony profile is paused. You can still open matches and chats.";
  }
  if (hub.status === "CLOSED") {
    return "Your matrimony profile is closed. Reactivate it to browse and receive proposals again.";
  }
  if (hub.status === "PENDING" || hub.status === "RESUBMITTED") {
    return "Your matrimony profile is under admin review. Browsing unlocks after approval.";
  }
  if (hub.status === "CHANGES_REQUESTED") {
    return "Admin requested changes. Complete the requested updates and resubmit before browsing.";
  }
  if (hub.status === "REJECTED") {
    return "Your matrimony application was rejected. Update your profile and submit again.";
  }
  if (hub.status === "APPROVED" && hub.completion_percentage < 100) {
    return `Complete your matrimony profile (${hub.completion_percentage}% done) before browsing.`;
  }
  if (hub.completion_percentage < 100) {
    return `Complete your matrimony profile (${hub.completion_percentage}% done) and submit for admin approval.`;
  }
  return "Complete matrimony setup and get admin approval before browsing profiles.";
}

export async function assertMatrimonyBrowseAllowed(userId: number): Promise<void> {
  const hub = await getMatrimonyHub(userId);
  if (!hub.can_browse) {
    const err = new Error(matrimonyBrowseBlockedMessage(hub));
    (err as any).status = 403;
    (err as any).code = "MATRIMONY_BROWSE_LOCKED";
    throw err;
  }
}

export async function getUserContext(userId: number) {
  const user = await User.findByPk(userId, {
    attributes: ["id", "fullName", "gender", "dob", "district", "city", "profilePhoto"]
  });
  if (!user) throw new Error("User not found");
  const profile = await UserProfile.findOne({
    where: { userId },
    attributes: ["community", "personal"]
  });
  const community = normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community) as {
    kulam?: string | null;
  } | null;
  const personal = normalizeJsonColumn(profile?.personal, SECTION_ALLOWED_KEYS.personal) as {
    fatherName?: string | null;
  } | null;
  const profile_image = await toPublicUrlIfR2(user.profilePhoto ?? null);
  return {
    full_name: user.fullName,
    gender: user.gender ?? null,
    date_of_birth: user.dob ? String(user.dob).slice(0, 10) : null,
    district: user.district ?? null,
    city: user.city ?? null,
    profile_image,
    father_name: personal?.fatherName ?? null,
    kulam: community?.kulam ?? null
  };
}

type HubLoadOptions = {
  /** Skip a second pending lookup when the caller already has the active row. */
  preloadedActive?: Awaited<ReturnType<typeof findActiveMatrimonyApplication>>;
};

export async function getMatrimonyHub(
  userId: number,
  opts?: HubLoadOptions
): Promise<MatrimonyHubResponse> {
  const [user, profileRow, active] = await Promise.all([
    User.findByPk(userId, {
      attributes: ["id", "fullName", "gender", "dob", "district", "city", "profilePhoto"]
    }),
    UserProfile.findOne({
      where: { userId },
      attributes: ["id", "userId", "matrimony", "community", "personal"]
    }),
    opts?.preloadedActive
      ? Promise.resolve(opts.preloadedActive)
      : findActiveMatrimonyApplication(userId)
  ]);
  if (!user) throw new Error("User not found");

  const { row: pendingRow, meta, latestWhenInactive } = active;
  const community = normalizeJsonColumn(profileRow?.community, SECTION_ALLOWED_KEYS.community) as {
    kulam?: string | null;
  } | null;
  const personal = normalizeJsonColumn(profileRow?.personal, SECTION_ALLOWED_KEYS.personal) as {
    fatherName?: string | null;
  } | null;
  const profile_image = await toPublicUrlIfR2(user.profilePhoto ?? null);
  const userContext = {
    full_name: user.fullName,
    gender: user.gender ?? null,
    date_of_birth: user.dob ? String(user.dob).slice(0, 10) : null,
    district: user.district ?? null,
    city: user.city ?? null,
    profile_image,
    father_name: personal?.fatherName ?? null,
    kulam: community?.kulam ?? null
  };

  const approved = stripInternalKeys(
    normalizeJsonColumn(profileRow?.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {}
  );
  const hasApproved = approved.matrimonyProfileActive === true;

  let draftUnsigned: MatrimonySection | null = null;
  let pending: MatrimonyHubResponse["pending"] = null;

  if (pendingRow) {
    const rawFull = readRawPendingData(pendingRow.data);
    const raw = normalizeJsonColumn(pendingRow.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
    draftUnsigned = stripInternalKeys(raw);

    const workflow = meta?.workflowStatus;
    const changeRequest =
      (rawFull[CHANGE_REQUEST_KEY] as MatrimonyChangeRequestInfo | undefined) ??
      meta?.changeRequest ??
      null;
    const resubCount = Number(rawFull[RESUB_COUNT_KEY] ?? meta?.resubmissionCount ?? 0);
    const requestedFields = changeRequest?.sections?.length
      ? fieldsForChangeSections(changeRequest.sections)
      : [];

    if (workflow === "CHANGES_REQUESTED" || (!isSubmittedPendingData(rawFull) && changeRequest)) {
      pending = {
        status: "CHANGES_REQUESTED",
        admin_remarks: pendingRow.adminRemarks ?? changeRequest?.comment ?? null,
        change_request: changeRequest,
        requested_fields: requestedFields,
        pending_update_id: pendingRow.id
      };
    } else if (isSubmittedPendingData(rawFull) && resubCount > 0) {
      pending = {
        status: "RESUBMITTED",
        admin_remarks: pendingRow.adminRemarks,
        change_request: changeRequest,
        requested_fields: requestedFields,
        pending_update_id: pendingRow.id
      };
    } else if (isSubmittedPendingData(rawFull)) {
      pending = {
        status: "PENDING",
        admin_remarks: pendingRow.adminRemarks,
        change_request: null,
        requested_fields: [],
        pending_update_id: pendingRow.id
      };
    }
  } else {
    // Reuse the latest row already loaded by findActiveMatrimonyApplication (no second round-trip).
    const lastRow = latestWhenInactive;
    if (lastRow?.status === "REJECTED") {
      const lastMeta = await loadMeta(lastRow.id);
      const isHardReject =
        lastMeta?.workflowStatus === "REJECTED" &&
        lastMeta?.rejectionReason !== "CHANGES_REQUESTED";
      if (isHardReject) {
        const raw = normalizeJsonColumn(lastRow.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
        draftUnsigned = stripInternalKeys(raw);
        pending = {
          status: "REJECTED",
          admin_remarks: lastRow.adminRemarks,
          change_request: null,
          requested_fields: [],
          pending_update_id: lastRow.id
        };
      }
    }
  }

  const requestedFields = pending?.requested_fields?.length ? pending.requested_fields : null;
  const draftForCompletion = draftUnsigned ?? (hasApproved ? null : approved);
  const { percentage, missing } = computeMatrimonyCompletion(
    hasApproved ? approved : null,
    draftForCompletion,
    user.profilePhoto ?? null,
    pending?.status === "CHANGES_REQUESTED" ? requestedFields : null
  );

  let status: MatrimonyHubStatus = "NOT_STARTED";
  if (pending?.status === "CHANGES_REQUESTED") status = "CHANGES_REQUESTED";
  else if (pending?.status === "RESUBMITTED") status = "RESUBMITTED";
  else if (pending?.status === "PENDING") status = "PENDING";
  else if (pending?.status === "REJECTED") status = "REJECTED";
  else if (hasApproved) {
    const life = normalizeMatrimonyLifecycle(approved);
    if (life === "PAUSED") status = "PAUSED";
    else if (life === "CLOSED") status = "CLOSED";
    else status = "APPROVED";
  } else if (draftUnsigned && Object.keys(draftUnsigned).length > 0) status = "DRAFT";
  else if (percentage > 0) status = "DRAFT";

  const lifecycle = hasApproved ? normalizeMatrimonyLifecycle(approved) : null;

  const can_browse = resolveMatrimonyCanBrowse({
    hasApproved,
    status,
    completionPercentage: percentage,
    approved: hasApproved ? approved : null
  });
  const can_submit =
    status === "CHANGES_REQUESTED" ||
    status === "DRAFT" ||
    status === "NOT_STARTED" ||
    status === "REJECTED"
      ? missing.length === 0
      : status !== "PENDING" &&
        status !== "RESUBMITTED" &&
        status !== "PAUSED" &&
        status !== "CLOSED" &&
        missing.length === 0;

  const can_pause = status === "APPROVED";
  const can_resume = status === "PAUSED";
  const can_close = status === "APPROVED" || status === "PAUSED";
  const can_reactivate = status === "CLOSED";

  const sectionForCandidate = (draftForCompletion ?? approved ?? {}) as MatrimonySection;
  const profileForSelf = isMatrimonyForSelf(sectionForCandidate.lookingFor ?? approved?.lookingFor);
  const candidateRaw = resolveCandidatePhotoUrl(sectionForCandidate as Record<string, unknown>);
  const candidateIdentity = resolveMatrimonyCandidate(
    {
      id: user.id,
      fullName: user.fullName,
      gender: user.gender,
      dob: user.dob,
      district: user.district,
      occupation: null,
      education: null
    },
    sectionForCandidate
  );

  // Sign URLs in parallel — same outputs as sequential signMatrimonySection / toPublicUrlIfR2.
  const [draft, approvedSigned, candidatePublicUrl] = await Promise.all([
    draftUnsigned ? signMatrimonySection(draftUnsigned) : Promise.resolve(null),
    hasApproved ? signMatrimonySection(approved) : Promise.resolve(null),
    candidateRaw ? toPublicUrlIfR2(candidateRaw) : Promise.resolve(null)
  ]);

  return {
    status,
    lifecycle,
    completion_percentage: percentage,
    can_browse,
    can_submit,
    can_pause,
    can_resume,
    can_close,
    can_reactivate,
    missing_fields: missing,
    approved: approvedSigned,
    draft,
    pending,
    user_context: userContext,
    account_profile_photo: userContext.profile_image,
    matrimony_candidate_photo: candidatePublicUrl,
    matrimony_candidate_name: candidateIdentity.name,
    profile_for_self: profileForSelf
  };
}
