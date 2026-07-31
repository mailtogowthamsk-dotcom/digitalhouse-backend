import { PendingProfileUpdate, MatrimonyRequestMeta, UserProfile } from "../../models";
import type { MatrimonySection } from "../../models/UserProfile.model";
import { MATRIMONY_SENSITIVE_KEYS } from "../../constants/matrimony.constants";
import { SECTION_ALLOWED_KEYS, normalizeJsonColumn } from "../Profile.service";
import {
  toPublicUrlIfR2,
  toPrivateSignedUrlIfR2,
  toStorageKeyIfR2,
  isPrivateR2Object
} from "../../utils/r2Client";
import { syncMatrimonyPhotoFields } from "../../constants/matrimony-photo.constants";
import {
  SUBMITTED_FLAG,
  INTERNAL_PENDING_KEYS,
  META_SAFE_ATTRIBUTES
} from "./matrimony.types";

export function readRawPendingData(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export function isSubmittedPendingData(rawData: Record<string, unknown> | null): boolean {
  if (!rawData) return false;
  return rawData[SUBMITTED_FLAG] === true;
}

export function stripInternalKeys(data: Record<string, unknown>): MatrimonySection {
  const allowed = SECTION_ALLOWED_KEYS.matrimony;
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  return out as MatrimonySection;
}

/** Mark uploaded matrimony media as attached so orphan cleanup won't delete it. */
export async function markMatrimonyMediaAttached(
  userId: number,
  section: Record<string, unknown>
): Promise<void> {
  const urls: string[] = [];
  for (const key of ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"]) {
    const v = section[key];
    if (typeof v === "string" && v.trim()) urls.push(v.trim());
  }
  const photos = section.candidatePhotos;
  if (Array.isArray(photos)) {
    for (const p of photos) {
      if (p && typeof p === "object" && typeof (p as { url?: string }).url === "string") {
        urls.push((p as { url: string }).url.trim());
      }
    }
  }
  if (urls.length === 0) return;
  const { mediaService } = await import("../Media.service");
  await mediaService.markMediaUrlsAttached(userId, urls).catch(() => undefined);
}

/**
 * New horoscope references must use the edge-protected prefix. An unchanged
 * legacy reference is accepted so old profiles remain editable.
 */
export function normalizeHoroscopeWrite(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>
): void {
  if (!Object.prototype.hasOwnProperty.call(incoming, "horoscopeDocumentUrl")) return;
  const value = incoming.horoscopeDocumentUrl;
  if (value == null || value === "") return;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Invalid horoscope document reference"), { status: 400 });
  }

  const key = toStorageKeyIfR2(value);
  const existingKey =
    typeof existing.horoscopeDocumentUrl === "string"
      ? toStorageKeyIfR2(existing.horoscopeDocumentUrl)
      : null;
  if (!key || (!isPrivateR2Object(key) && key !== existingKey)) {
    throw Object.assign(
      new Error("New horoscope uploads must use private horoscope storage"),
      { status: 400 }
    );
  }
  incoming.horoscopeDocumentUrl = key;
}

/**
 * Owner/admin matrimony payload: photos are public CDN URLs, the horoscope document
 * is private and always returned as a short-lived signed GET URL.
 */
export async function signMatrimonySection(
  section: MatrimonySection | null
): Promise<MatrimonySection | null> {
  if (!section) return null;
  const out = { ...section } as Record<string, unknown>;
  const profilePhotoUrl = out.profilePhotoUrl;
  if (typeof profilePhotoUrl === "string" && profilePhotoUrl.trim()) {
    out.profilePhotoUrl = (await toPublicUrlIfR2(profilePhotoUrl)) ?? profilePhotoUrl;
  }
  const candidatePhotoUrl = out.candidatePhotoUrl;
  if (typeof candidatePhotoUrl === "string" && candidatePhotoUrl.trim()) {
    out.candidatePhotoUrl = (await toPublicUrlIfR2(candidatePhotoUrl)) ?? candidatePhotoUrl;
  }
  const horoscopeDocumentUrl = out.horoscopeDocumentUrl;
  if (typeof horoscopeDocumentUrl === "string" && horoscopeDocumentUrl.trim()) {
    out.horoscopeDocumentUrl = await toPrivateSignedUrlIfR2(horoscopeDocumentUrl);
  }
  return out as MatrimonySection;
}

export async function loadMeta(pendingUpdateId: number): Promise<MatrimonyRequestMeta | null> {
  try {
    return await MatrimonyRequestMeta.findOne({
      where: { pendingUpdateId },
      attributes: [...META_SAFE_ATTRIBUTES]
    });
  } catch {
    return null;
  }
}

/** Reopen legacy rows that were wrongly marked REJECTED for change requests */
async function reopenChangeRequestRow(row: PendingProfileUpdate): Promise<PendingProfileUpdate> {
  const raw = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  await row.update({
    status: "PENDING",
    reviewedAt: null,
    data: { ...raw, [SUBMITTED_FLAG]: false },
    updatedAt: new Date()
  } as any);
  return row;
}

/** Active matrimony application row (pending or reopened change-request) */
export async function findActiveMatrimonyApplication(userId: number): Promise<{
  row: PendingProfileUpdate | null;
  meta: MatrimonyRequestMeta | null;
}> {
  let row = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" },
    order: [["submittedAt", "DESC"]]
  });

  if (!row) {
    const last = await PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY" },
      order: [["submittedAt", "DESC"]]
    });
    if (last?.status === "REJECTED") {
      const meta = last ? await loadMeta(last.id) : null;
      if (
        meta?.workflowStatus === "CHANGES_REQUESTED" ||
        meta?.rejectionReason === "CHANGES_REQUESTED"
      ) {
        row = await reopenChangeRequestRow(last);
      }
    }
  }

  const meta = row ? await loadMeta(row.id) : null;
  return { row, meta };
}

export async function upsertMatrimonyPending(
  userId: number,
  payload: Record<string, unknown>,
  submittedForReview: boolean
): Promise<PendingProfileUpdate> {
  const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
  const { row: existingPending } = await findActiveMatrimonyApplication(userId);
  let existing = existingPending;

  if (!existing) {
    const rejected = await PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY", status: "REJECTED" },
      order: [["submittedAt", "DESC"]]
    });
    if (rejected) {
      const meta = await loadMeta(rejected.id);
      if (
        meta?.workflowStatus === "CHANGES_REQUESTED" ||
        meta?.rejectionReason === "CHANGES_REQUESTED"
      ) {
        existing = await reopenChangeRequestRow(rejected);
      }
    }
  }

  const rawFull = existing ? readRawPendingData(existing.data) : {};
  const existingData = normalizeJsonColumn(existing?.data, allowedKeys) ?? {};
  const merged = syncMatrimonyPhotoFields({
    ...rawFull,
    ...existingData,
    ...payload,
    [SUBMITTED_FLAG]: submittedForReview
  });
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(
      ([k, v]) => v !== undefined && (allowedKeys.has(k) || INTERNAL_PENDING_KEYS.has(k))
    )
  ) as Record<string, unknown>;

  if (existing) {
    await existing.update({ data: cleaned, submittedAt: new Date(), updatedAt: new Date() } as any);
    return existing;
  }
  return PendingProfileUpdate.create({
    userId,
    section: "MATRIMONY",
    data: cleaned,
    status: "PENDING",
    submittedAt: new Date(),
    reviewedAt: null,
    adminRemarks: null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);
}

/** After approved matrimony: changing photo/kulam/horoscope requires re-review */
export async function queueMatrimonyReReviewIfNeeded(
  userId: number,
  changedKeys: string[]
): Promise<void> {
  const profile = await UserProfile.findOne({ where: { userId } });
  const approved = stripInternalKeys(
    normalizeJsonColumn(profile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {}
  );
  if (approved.matrimonyProfileActive !== true) return;

  const needs = changedKeys.some((k) =>
    (MATRIMONY_SENSITIVE_KEYS as readonly string[]).includes(k)
  );
  if (!needs) return;

  const pending = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" }
  });
  if (pending && isSubmittedPendingData(normalizeJsonColumn(pending.data) ?? {})) return;

  await upsertMatrimonyPending(userId, { ...approved, matrimonyProfileActive: true }, true);
}
