import { Op, Transaction } from "sequelize";
import { sequelize } from "../../config/db";
import {
  ContentSafetyFingerprint,
  ContentSafetyScan,
  MediaFile,
  Post,
  User
} from "../../models";
import {
  CONTENT_SAFETY_POLICY_VERSION,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_VERSION,
  QUARANTINE_MEDIA_MODULES
} from "../../constants/contentSafety.constants";
import { getR2ObjectBuffer, extractR2KeyFromUrl, downloadR2ObjectToFile } from "../../utils/r2Client";
import { collectMediaArtifactKeys } from "../../utils/mediaArtifactKeys";
import { parseMarketplaceGallery } from "../../utils/marketplaceGallery";
import { parseHelpGallery } from "../../utils/helpGallery";
import { emitFeedNewPost } from "../../realtime/feedEvents";
import { classifyImageBuffer } from "./localProvider";
import { extractModerationFramesFromPath } from "./videoFrames";
import {
  createMediaTempDirectory,
  removeMediaTempDirectory
} from "../../utils/mediaTempFiles";
import path from "path";
import {
  combinePolicyEvaluations,
  evaluateModeration,
  policyVerdictToSafetyDecision
} from "./policyEngine";
import { moderateText } from "./textModerator";
import {
  computeImageDHash,
  fingerprintAlgorithm,
  isKnownBadHashMatch
} from "./fingerprint";
import {
  deletePromotedQuarantineKeys,
  promoteQuarantineKeys,
  rewriteStoredKey
} from "./quarantine";
import type { NormalizedModerationResult, PolicyEvaluation } from "./types";
import { initialSafetyForCreate, nextSafetyAfterEdit } from "./initialSafety";

export { initialSafetyForCreate };

type ClassifyFn = (buffer: Buffer) => Promise<NormalizedModerationResult>;

let classifyImage: ClassifyFn = classifyImageBuffer;

/** Test-only injection. Production always uses the local nsfwjs provider. */
export function setImageClassifierForTests(fn: ClassifyFn | null): void {
  classifyImage = fn ?? classifyImageBuffer;
}

function moderationConcurrency(): number {
  const n = Number(process.env.MODERATION_MAX_CONCURRENCY || 1);
  return Number.isFinite(n) ? Math.min(2, Math.max(1, Math.floor(n))) : 1;
}

let activeInferences = 0;
const waiters: Array<() => void> = [];

async function withInferenceSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = moderationConcurrency();
  if (activeInferences >= max) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeInferences += 1;
  try {
    return await fn();
  } finally {
    activeInferences -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

function logSafety(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...fields
    })
  );
}

async function writeScan(input: {
  postId: number | null;
  mediaId: number | null;
  jobId: number | null;
  mediaVersion: number;
  mediaType: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  status: string;
  category: string;
  confidence: number | null;
  decision: string;
  failureReason: string | null;
  processingTimeMs: number | null;
}): Promise<void> {
  const now = new Date();
  await ContentSafetyScan.create({
    ...input,
    createdAt: now,
    completedAt: now
  } as any);
}

async function findKnownBad(hash: string): Promise<ContentSafetyFingerprint | null> {
  const rows = await ContentSafetyFingerprint.findAll({
    attributes: ["id", "hash", "category", "decision"],
    limit: 20_000,
    order: [["id", "DESC"]]
  });
  return rows.find((row) => isKnownBadHashMatch(hash, row.hash)) ?? null;
}

async function storeFingerprint(input: {
  hash: string;
  mediaType: string;
  category: string;
  decision: string;
  postId: number | null;
  mediaId: number | null;
}): Promise<void> {
  await ContentSafetyFingerprint.create({
    hash: input.hash,
    algorithm: fingerprintAlgorithm,
    mediaType: input.mediaType,
    category: input.category,
    decision: input.decision,
    postId: input.postId,
    mediaId: input.mediaId,
    createdAt: new Date()
  } as any);
}

export async function afterCreatePostSafety(post: Post): Promise<void> {
  if (post.safetyDecision !== "SAFE") return;
  const author = await User.findByPk(post.userId, { attributes: ["community"] });
  if (post.postType !== "MARKETPLACE") {
    emitFeedNewPost(author?.community ?? null, post.id);
  }
}

function postHasMedia(post: Post): boolean {
  return Boolean(post.mediaUrl || post.thumbnailUrl);
}

export async function applyEditSafety(post: Post, changed: {
  caption: boolean;
  media: boolean;
}): Promise<void> {
  const text = moderateText(`${post.title}\n${post.description ?? ""}`);
  const next = nextSafetyAfterEdit({
    captionChanged: changed.caption,
    mediaChanged: changed.media,
    textVerdict: text.verdict,
    textCategory: text.category,
    textReason: text.reason,
    hasMedia: postHasMedia(post),
    currentMediaVersion: post.mediaVersion || 1
  });
  if (!next) return;
  if (next.tryPublishTextOnly) {
    await tryPublishIfEligible(post.id, next.mediaVersion, {
      category: "SAFE",
      confidence: 1,
      model: "text",
      modelVersion: "v1",
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      reason: "TEXT_ONLY_EDIT"
    });
    return;
  }
  await post.update({
    safetyDecision: next.safetyDecision,
    safetyCategory: next.safetyCategory,
    safetyFailureReason: next.safetyFailureReason,
    mediaVersion: next.mediaVersion,
    moderatedMediaVersion: next.moderatedMediaVersion
  } as any);
}

async function classifyImageMedia(
  buffer: Buffer
): Promise<{ evaluation: PolicyEvaluation; result: NormalizedModerationResult; hash?: string }> {
  let hash: string | undefined;
  try {
    hash = await computeImageDHash(buffer);
    const known = await findKnownBad(hash);
    if (known) {
      const result: NormalizedModerationResult = {
        available: true,
        category: (known.category as NormalizedModerationResult["category"]) || "OTHER_PROHIBITED",
        confidence: 1,
        failed: false,
        timeout: false,
        corrupt: false,
        unsupported: false,
        insufficientCoverage: false,
        modelName: "perceptual-fingerprint",
        modelVersion: fingerprintAlgorithm
      };
      return { evaluation: evaluateModeration(result), result, hash };
    }
  } catch {
    hash = undefined;
  }
  const result = await withInferenceSlot(() => classifyImage(buffer));
  return { evaluation: evaluateModeration(result), result, hash };
}

function insufficientVideoResult(): NormalizedModerationResult {
  return {
    available: false,
    category: "UNCERTAIN",
    confidence: null,
    failed: true,
    timeout: false,
    corrupt: false,
    unsupported: false,
    insufficientCoverage: true,
    modelName: LOCAL_MODEL_NAME,
    modelVersion: LOCAL_MODEL_VERSION,
    failureReason: "INSUFFICIENT_ANALYSIS"
  };
}

async function classifyVideoFrames(
  frames: Buffer[],
  plan: { insufficientCoverage: boolean }
): Promise<{ evaluation: PolicyEvaluation; result: NormalizedModerationResult }> {
  if (plan.insufficientCoverage || frames.length === 0) {
    const result = insufficientVideoResult();
    return { evaluation: evaluateModeration(result), result };
  }
  const frameEvals: PolicyEvaluation[] = [];
  let last: NormalizedModerationResult | null = null;
  for (const frame of frames) {
    const result = await withInferenceSlot(() => classifyImage(frame));
    last = result;
    frameEvals.push(evaluateModeration(result));
    if (frameEvals[frameEvals.length - 1]?.verdict === "BLOCK") break;
  }
  const evaluation = combinePolicyEvaluations(frameEvals);
  return {
    evaluation,
    result: last ?? {
      ...insufficientVideoResult(),
      failureReason: "MISSING_RESULT"
    }
  };
}

async function classifyVideoFromR2(
  key: string,
  maxBytes: number
): Promise<{ evaluation: PolicyEvaluation; result: NormalizedModerationResult }> {
  const tmp = await createMediaTempDirectory("dh-mod-");
  const inPath = path.join(tmp, "in.bin");
  try {
    await downloadR2ObjectToFile(key, inPath, maxBytes);
    const { frames, plan } = await extractModerationFramesFromPath(inPath);
    return classifyVideoFrames(frames, plan);
  } finally {
    await removeMediaTempDirectory(tmp);
  }
}

async function postsReferencingMedia(media: MediaFile): Promise<Post[]> {
  const keys = new Set<string>();
  const objectKey = media.objectKey || extractR2KeyFromUrl(media.fileUrl);
  if (objectKey) keys.add(objectKey);
  if (media.fileUrl) {
    const k = extractR2KeyFromUrl(media.fileUrl);
    if (k) keys.add(k);
  }
  for (const artifact of collectMediaArtifactKeys(objectKey ?? media.fileUrl, media.variantsJson)) {
    keys.add(artifact);
  }
  if (keys.size === 0) return [];
  const or = [...keys].flatMap((key) => [{ mediaUrl: key }, { thumbnailUrl: key }]);
  return Post.findAll({
    where: {
      userId: media.userId,
      [Op.or]: or
    },
    limit: 50
  });
}

async function rewritePostMediaKeys(post: Post, mapping: Map<string, string>, transaction: Transaction): Promise<void> {
  if (mapping.size === 0) return;
  const mediaUrl = rewriteStoredKey(post.mediaUrl, mapping);
  const thumbnailUrl = rewriteStoredKey(post.thumbnailUrl, mapping);
  let marketplaceGallery = post.marketplaceGallery;
  if (post.postType === "MARKETPLACE") {
    marketplaceGallery = parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl).map(
      (u) => rewriteStoredKey(u, mapping) ?? u
    );
  }
  let helpGallery = post.helpGallery;
  if (post.postType === "HELP_REQUEST") {
    helpGallery = parseHelpGallery(post.helpGallery, post.mediaUrl).map(
      (u) => rewriteStoredKey(u, mapping) ?? u
    );
  }
  await post.update(
    { mediaUrl, thumbnailUrl, marketplaceGallery, helpGallery } as any,
    { transaction }
  );
}

export async function tryPublishIfEligible(
  postId: number,
  expectedMediaVersion: number,
  meta: {
    category: string;
    confidence: number | null;
    model: string;
    modelVersion: string;
    policyVersion: string;
    reason: string;
  }
): Promise<boolean> {
  const published = await sequelize.transaction(async (transaction) => {
    const post = await Post.findByPk(postId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!post) return false;
    if (post.deletedAt || post.moderationStatus === "SOFT_DELETED") return false;
    if (post.mediaVersion !== expectedMediaVersion) return false;
    const text = moderateText(`${post.title}\n${post.description ?? ""}`);
    if (text.verdict !== "SAFE") return false;
    const [affected] = await Post.update(
      {
        safetyDecision: "SAFE",
        safetyCategory: meta.category,
        safetyConfidence: meta.confidence,
        safetyModel: meta.model,
        safetyModelVersion: meta.modelVersion,
        safetyPolicyVersion: meta.policyVersion,
        safetyFailureReason: null,
        moderatedMediaVersion: expectedMediaVersion
      } as any,
      {
        where: {
          id: postId,
          mediaVersion: expectedMediaVersion,
          moderationStatus: { [Op.ne]: "SOFT_DELETED" },
          deletedAt: null
        },
        transaction
      }
    );
    return affected > 0;
  });
  if (!published) return false;
  const post = await Post.findByPk(postId);
  if (!post) return true;
  if (post.postType !== "MARKETPLACE" || post.marketplaceStatus === "LIVE") {
    const author = await User.findByPk(post.userId, { attributes: ["community"] });
    emitFeedNewPost(author?.community ?? null, post.id);
  }
  logSafety("moderation_published", {
    post_id: post.id,
    media_version: expectedMediaVersion,
    policy_version: meta.policyVersion
  });
  return true;
}

export async function moderateProcessedMedia(mediaId: number, jobId: number | null): Promise<void> {
  const started = Date.now();
  const media = await MediaFile.findByPk(mediaId);
  if (!media) return;
  if (!(QUARANTINE_MEDIA_MODULES as readonly string[]).includes(media.module)) return;

  const key = media.objectKey || extractR2KeyFromUrl(media.fileUrl);
  if (!key) {
    await media.update({ safetyDecision: "FAILED", safetyCategory: "UNCERTAIN" });
    return;
  }

  logSafety("moderation_started", {
    media_id: mediaId,
    job_id: jobId,
    media_version: media.mediaVersion,
    model: LOCAL_MODEL_NAME,
    model_version: LOCAL_MODEL_VERSION,
    policy_version: CONTENT_SAFETY_POLICY_VERSION
  });

  const maxBytes =
    media.fileType === "video"
      ? Number(process.env.MODERATION_MAX_VIDEO_BYTES || 50 * 1024 * 1024)
      : Number(process.env.MODERATION_MAX_IMAGE_SIZE || 2_000_000);

  let evaluation: PolicyEvaluation;
  let result: NormalizedModerationResult;
  let hash: string | undefined;
  try {
    if (media.fileType === "video") {
      const classified = await classifyVideoFromR2(key, maxBytes);
      evaluation = classified.evaluation;
      result = classified.result;
    } else {
      const buffer = await getR2ObjectBuffer(key, maxBytes);
      const classified = await classifyImageMedia(buffer);
      evaluation = classified.evaluation;
      result = classified.result;
      hash = classified.hash;
    }
  } catch (err) {
    evaluation = evaluateModeration({
      available: false,
      category: "UNCERTAIN",
      confidence: null,
      failed: true,
      timeout: false,
      corrupt: true,
      unsupported: false,
      insufficientCoverage: false,
      modelName: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      failureReason: err instanceof Error ? err.message.slice(0, 200) : "DOWNLOAD_FAILED"
    });
    result = {
      available: false,
      category: "UNCERTAIN",
      confidence: null,
      failed: true,
      timeout: false,
      corrupt: true,
      unsupported: false,
      insufficientCoverage: false,
      modelName: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      failureReason: evaluation.reason
    };
  }

  const decision = policyVerdictToSafetyDecision(evaluation.verdict);
  const processingTimeMs = Date.now() - started;
  const posts = await postsReferencingMedia(media);

  await media.update({
    safetyDecision: decision,
    safetyCategory: evaluation.category,
    perceptualHash: hash ?? media.perceptualHash
  });

  if ((decision === "BLOCKED" || decision === "REVIEW_REQUIRED") && hash) {
    await storeFingerprint({
      hash,
      mediaType: media.fileType,
      category: evaluation.category,
      decision,
      postId: posts[0]?.id ?? null,
      mediaId: media.id
    });
  }

  for (const post of posts) {
    const text = moderateText(`${post.title}\n${post.description ?? ""}`);
    const combined = combinePolicyEvaluations([
      evaluation,
      {
        verdict: text.verdict,
        category: text.category,
        confidence: text.verdict === "SAFE" ? 1 : 0.5,
        reason: text.reason,
        policyVersion: CONTENT_SAFETY_POLICY_VERSION
      }
    ]);
    const postDecision = policyVerdictToSafetyDecision(combined.verdict);
    await writeScan({
      postId: post.id,
      mediaId: media.id,
      jobId,
      mediaVersion: post.mediaVersion,
      mediaType: media.fileType,
      model: result.modelName,
      modelVersion: result.modelVersion,
      policyVersion: combined.policyVersion,
      status: postDecision,
      category: combined.category,
      confidence: combined.confidence,
      decision: combined.verdict === "SAFE" ? "SAFE" : combined.verdict === "BLOCK" ? "BLOCK" : "REVIEW",
      failureReason: combined.verdict === "SAFE" ? null : combined.reason,
      processingTimeMs
    });

    if (postDecision !== "SAFE") {
      const [affected] = await Post.update(
        {
          safetyDecision: postDecision,
          safetyCategory: combined.category,
          safetyConfidence: combined.confidence,
          safetyModel: result.modelName,
          safetyModelVersion: result.modelVersion,
          safetyPolicyVersion: combined.policyVersion,
          safetyFailureReason: combined.reason,
          moderatedMediaVersion: null
        } as any,
        {
          where: {
            id: post.id,
            mediaVersion: post.mediaVersion
          }
        }
      );
      if (affected > 0) {
        logSafety(
          postDecision === "BLOCKED" ? "moderation_blocked" : "moderation_review_required",
          {
            post_id: post.id,
            media_id: media.id,
            job_id: jobId,
            media_version: post.mediaVersion,
            category: combined.category,
            policy_version: combined.policyVersion
          }
        );
      }
      continue;
    }

    const mapping = await promoteQuarantineKeys(
      [post.mediaUrl, post.thumbnailUrl, media.objectKey, media.fileUrl],
      media.variantsJson
    );
    await sequelize.transaction(async (transaction) => {
      const locked = await Post.findByPk(post.id, { transaction, lock: Transaction.LOCK.UPDATE });
      if (!locked || locked.mediaVersion !== post.mediaVersion) return;
      await rewritePostMediaKeys(locked, mapping, transaction);
      if (mapping.size > 0) {
        const nextKey = rewriteStoredKey(media.objectKey || media.fileUrl, mapping);
        const nextFileUrl = rewriteStoredKey(media.fileUrl, mapping);
        let nextVariants = media.variantsJson;
        if (nextVariants) {
          try {
            const parsed = JSON.parse(nextVariants) as Record<string, unknown>;
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === "string") parsed[k] = rewriteStoredKey(v, mapping) ?? v;
            }
            nextVariants = JSON.stringify(parsed);
          } catch {
            /* keep */
          }
        }
        await media.update(
          { objectKey: nextKey, fileUrl: nextFileUrl ?? media.fileUrl, variantsJson: nextVariants },
          { transaction }
        );
      }
    });
    const published = await tryPublishIfEligible(post.id, post.mediaVersion, {
      category: combined.category,
      confidence: combined.confidence,
      model: result.modelName,
      modelVersion: result.modelVersion,
      policyVersion: combined.policyVersion,
      reason: combined.reason
    });
    if (published) {
      await deletePromotedQuarantineKeys(mapping);
    }
    logSafety("moderation_completed", {
      post_id: post.id,
      media_id: media.id,
      job_id: jobId,
      media_version: post.mediaVersion,
      decision: postDecision,
      published,
      processing_time_ms: processingTimeMs
    });
  }

  if (media.module === "profile") {
    await maybePromoteProfilePhoto(media, decision, hash);
  }
}

async function maybePromoteProfilePhoto(
  media: MediaFile,
  decision: string,
  hash?: string
): Promise<void> {
  if (decision !== "SAFE") return;
  const mapping = await promoteQuarantineKeys([media.objectKey, media.fileUrl], media.variantsJson);
  if (mapping.size === 0) return;
  const nextKey = rewriteStoredKey(media.objectKey || media.fileUrl, mapping);
  await media.update({
    objectKey: nextKey,
    fileUrl: rewriteStoredKey(media.fileUrl, mapping) ?? media.fileUrl,
    safetyDecision: "SAFE"
  });
  const user = await User.findByPk(media.userId, { attributes: ["id", "profilePhoto"] });
  if (user?.profilePhoto) {
    const rewritten = rewriteStoredKey(user.profilePhoto, mapping);
    if (rewritten && rewritten !== user.profilePhoto) {
      await user.update({ profilePhoto: rewritten });
    }
  }
  await deletePromotedQuarantineKeys(mapping);
  void hash;
}

export async function markMediaModerationFailed(mediaId: number, jobId: number | null, reason: string): Promise<void> {
  const media = await MediaFile.findByPk(mediaId);
  if (!media) return;
  await media.update({ safetyDecision: "FAILED", safetyCategory: "UNCERTAIN" });
  const posts = await postsReferencingMedia(media);
  for (const post of posts) {
    await Post.update(
      {
        safetyDecision: "FAILED",
        safetyCategory: "UNCERTAIN",
        safetyFailureReason: reason.slice(0, 255),
        moderatedMediaVersion: null
      } as any,
      { where: { id: post.id, mediaVersion: post.mediaVersion } }
    );
    await writeScan({
      postId: post.id,
      mediaId,
      jobId,
      mediaVersion: post.mediaVersion,
      mediaType: media.fileType,
      model: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      status: "FAILED",
      category: "UNCERTAIN",
      confidence: null,
      decision: "FAILED",
      failureReason: reason.slice(0, 255),
      processingTimeMs: null
    });
    logSafety("moderation_failed", {
      post_id: post.id,
      media_id: mediaId,
      job_id: jobId,
      media_version: post.mediaVersion,
      reason: reason.slice(0, 120)
    });
  }
}

export async function adminAllowPost(
  postId: number,
  adminEmail: string,
  expectedMediaVersion: number,
  remarks?: string
): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  if (post.deletedAt || post.moderationStatus === "SOFT_DELETED") {
    throw Object.assign(new Error("Deleted posts cannot be allowed"), { status: 400 });
  }
  if (post.mediaVersion !== expectedMediaVersion) {
    throw Object.assign(new Error("Content changed since this review. Refresh and try again."), {
      status: 409,
      code: "SAFETY_VERSION_CONFLICT"
    });
  }
  const mapping = await promoteQuarantineKeys(
    [post.mediaUrl, post.thumbnailUrl],
    null
  );
  const ok = await sequelize.transaction(async (transaction) => {
    const locked = await Post.findByPk(postId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!locked) return false;
    if (locked.mediaVersion !== expectedMediaVersion) return false;
    if (locked.deletedAt || locked.moderationStatus === "SOFT_DELETED") return false;
    await rewritePostMediaKeys(locked, mapping, transaction);
    const [affected] = await Post.update(
      {
        safetyDecision: "SAFE",
        safetyCategory: locked.safetyCategory || "SAFE",
        safetyModel: "admin-override",
        safetyModelVersion: "manual",
        safetyPolicyVersion: CONTENT_SAFETY_POLICY_VERSION,
        safetyFailureReason: null,
        moderatedMediaVersion: expectedMediaVersion
      } as any,
      {
        where: {
          id: postId,
          mediaVersion: expectedMediaVersion,
          deletedAt: null
        },
        transaction
      }
    );
    return affected > 0;
  });
  if (!ok) {
    throw Object.assign(new Error("Allow did not apply — content changed or was deleted."), {
      status: 409,
      code: "SAFETY_ALLOW_RACE"
    });
  }
  const { ModerationAction } = await import("../../models");
  await ModerationAction.create({
    action: "SAFETY_ALLOW",
    targetUserId: post.userId,
    postId,
    reportKind: null,
    reportId: null,
    adminEmail,
    note: remarks?.trim() || "Admin allow after review",
    createdAt: new Date()
  } as any);
  await deletePromotedQuarantineKeys(mapping);
  const author = await User.findByPk(post.userId, { attributes: ["community"] });
  if (post.postType !== "MARKETPLACE" || post.marketplaceStatus === "LIVE") {
    emitFeedNewPost(author?.community ?? null, post.id);
  }
  logSafety("moderation_admin_override", {
    post_id: postId,
    media_version: expectedMediaVersion,
    decision: "ALLOW",
    admin: adminEmail
  });
}

export async function adminRejectPost(
  postId: number,
  adminEmail: string,
  expectedMediaVersion: number,
  reason?: string
): Promise<void> {
  const ok = await sequelize.transaction(async (transaction) => {
    const locked = await Post.findByPk(postId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!locked) throw Object.assign(new Error("Post not found"), { status: 404 });
    if (locked.mediaVersion !== expectedMediaVersion) {
      throw Object.assign(new Error("Content changed since this review. Refresh and try again."), {
        status: 409,
        code: "SAFETY_VERSION_CONFLICT"
      });
    }
    const [affected] = await Post.update(
      {
        safetyDecision: "BLOCKED",
        safetyCategory: locked.safetyCategory || "OTHER_PROHIBITED",
        safetyFailureReason: reason?.slice(0, 255) || "ADMIN_REJECT",
        moderatedMediaVersion: null
      } as any,
      {
        where: { id: postId, mediaVersion: expectedMediaVersion },
        transaction
      }
    );
    return affected > 0;
  });
  if (!ok) {
    throw Object.assign(new Error("Reject did not apply — content changed."), {
      status: 409,
      code: "SAFETY_REJECT_RACE"
    });
  }
  const post = await Post.findByPk(postId);
  const { ModerationAction } = await import("../../models");
  await ModerationAction.create({
    action: "SAFETY_REJECT",
    targetUserId: post?.userId ?? null,
    postId,
    reportKind: null,
    reportId: null,
    adminEmail,
    note: reason?.trim() || "Admin reject",
    createdAt: new Date()
  } as any);
  logSafety("moderation_admin_override", {
    post_id: postId,
    media_version: expectedMediaVersion,
    decision: "REJECT",
    admin: adminEmail
  });
}

export async function listSafetyScans(postId: number) {
  return ContentSafetyScan.findAll({
    where: { postId },
    order: [["id", "DESC"]],
    limit: 50
  });
}
