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
import {
  autoLiveMarketplaceIfEligible,
  holdMarketplaceForSafetyReview
} from "../marketplace/liveListingGuard";
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
  publishedKeyFromQuarantine,
  rewriteStoredKey
} from "./quarantine";
import type { NormalizedModerationResult, PolicyEvaluation } from "./types";
import { initialSafetyForCreate, nextSafetyAfterEdit } from "./initialSafety";
import {
  allowNonSexualUncertainty,
  isProhibitedSafetyCategory
} from "./uncertaintyPolicy";

export { initialSafetyForCreate };
export { allowNonSexualUncertainty, isProhibitedSafetyCategory } from "./uncertaintyPolicy";

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
  const failureReason =
    input.failureReason != null ? input.failureReason.replace(/\s+/g, " ").slice(0, 240) : null;
  await ContentSafetyScan.create({
    ...input,
    failureReason,
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

function mediaKeysForPost(post: Post): string[] {
  const keys = new Set<string>();
  for (const raw of [post.mediaUrl, post.thumbnailUrl]) {
    if (!raw) continue;
    const k = extractR2KeyFromUrl(raw) ?? raw;
    keys.add(k);
    const published = publishedKeyFromQuarantine(k);
    if (published) keys.add(published);
  }
  if (post.postType === "MARKETPLACE") {
    for (const u of parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl)) {
      const k = extractR2KeyFromUrl(u) ?? u;
      keys.add(k);
    }
  }
  if (post.postType === "HELP_REQUEST") {
    for (const u of parseHelpGallery(post.helpGallery, post.mediaUrl)) {
      const k = extractR2KeyFromUrl(u) ?? u;
      keys.add(k);
    }
  }
  return [...keys];
}

async function findMediaFilesForPost(post: Post): Promise<MediaFile[]> {
  const keys = new Set<string>();
  for (const raw of mediaKeysForPost(post)) {
    keys.add(raw);
    for (const artifact of collectMediaArtifactKeys(raw, null)) {
      keys.add(artifact);
    }
  }
  if (!keys.size) return [];
  const keyList = [...keys];
  return MediaFile.findAll({
    where: {
      userId: post.userId,
      [Op.or]: [{ objectKey: { [Op.in]: keyList } }, { fileUrl: { [Op.in]: keyList } }]
    },
    limit: 20
  });
}

/**
 * Fast path: reuse media_files safety already computed by the worker.
 * Avoids a second R2 download + NSFW inference on post create (race case).
 * Returns true when the post decision was applied (SAFE / REVIEW / BLOCKED).
 */
async function applyCachedMediaSafetyToPost(post: Post, media: MediaFile): Promise<boolean> {
  const decision = media.safetyDecision;
  if (!decision || decision === "PENDING" || decision === "PROCESSING") {
    return false;
  }

  const text = moderateText(`${post.title}\n${post.description ?? ""}`);
  if (text.verdict === "BLOCK") {
    await Post.update(
      {
        safetyDecision: "BLOCKED",
        safetyCategory: text.category,
        safetyFailureReason: text.reason,
        moderatedMediaVersion: null
      } as any,
      { where: { id: post.id, mediaVersion: post.mediaVersion } }
    );
    if (post.postType === "MARKETPLACE") await holdMarketplaceForSafetyReview(post.id);
    return true;
  }
  if (text.verdict === "REVIEW") {
    await Post.update(
      {
        safetyDecision: "REVIEW_REQUIRED",
        safetyCategory: text.category,
        safetyFailureReason: text.reason,
        moderatedMediaVersion: null
      } as any,
      { where: { id: post.id, mediaVersion: post.mediaVersion } }
    );
    if (post.postType === "MARKETPLACE") await holdMarketplaceForSafetyReview(post.id);
    return true;
  }

  const prohibited = isProhibitedSafetyCategory(media.safetyCategory);
  const softSafe =
    decision === "SAFE" ||
    decision === "FAILED" ||
    (decision === "REVIEW_REQUIRED" && !prohibited && media.safetyCategory === "UNCERTAIN");

  if (softSafe) {
    const mapping = await promoteQuarantineKeys(
      [post.mediaUrl, post.thumbnailUrl, media.objectKey, media.fileUrl],
      media.variantsJson
    );
    if (mapping.size > 0) {
      await sequelize.transaction(async (transaction) => {
        const locked = await Post.findByPk(post.id, {
          transaction,
          lock: Transaction.LOCK.UPDATE
        });
        if (!locked || locked.mediaVersion !== post.mediaVersion) return;
        await rewritePostMediaKeys(locked, mapping, transaction);
        const nextKey = rewriteStoredKey(media.objectKey || media.fileUrl, mapping);
        const nextFileUrl = rewriteStoredKey(media.fileUrl, mapping);
        await media.update(
          {
            objectKey: nextKey ?? media.objectKey,
            fileUrl: nextFileUrl ?? media.fileUrl,
            safetyDecision: "SAFE",
            safetyCategory: "SAFE"
          } as any,
          { transaction }
        );
      });
    } else if (media.safetyDecision !== "SAFE") {
      await media.update({ safetyDecision: "SAFE", safetyCategory: "SAFE" } as any);
    }

    const published = await tryPublishIfEligible(post.id, post.mediaVersion || 1, {
      category: "SAFE",
      confidence: null,
      model: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      reason:
        decision === "SAFE"
          ? "CACHED_MEDIA_SAFE"
          : "AUTO_ALLOW_NON_SEXUAL_UNCERTAIN"
    });
    if (published && mapping.size > 0) {
      await deletePromotedQuarantineKeys(mapping);
    }
    logSafety("moderation_applied_cached", {
      post_id: post.id,
      media_id: media.id,
      from_decision: decision,
      published
    });
    return true;
  }

  if (decision === "BLOCKED" || (decision === "REVIEW_REQUIRED" && prohibited)) {
    await Post.update(
      {
        safetyDecision: decision === "BLOCKED" ? "BLOCKED" : "REVIEW_REQUIRED",
        safetyCategory: media.safetyCategory,
        safetyFailureReason: "CACHED_MEDIA_REVIEW",
        moderatedMediaVersion: null
      } as any,
      { where: { id: post.id, mediaVersion: post.mediaVersion } }
    );
    if (post.postType === "MARKETPLACE") await holdMarketplaceForSafetyReview(post.id);
    logSafety("moderation_applied_cached_review", {
      post_id: post.id,
      media_id: media.id,
      decision,
      category: media.safetyCategory
    });
    return true;
  }

  return false;
}

/**
 * After create: SAFE text posts go live immediately.
 * Media posts: apply worker result if already done (fast); otherwise leave PENDING
 * for the media worker (no double NSFW on the create request path).
 */
export async function afterCreatePostSafety(post: Post): Promise<void> {
  if (post.safetyDecision === "SAFE") {
    if (post.postType === "MARKETPLACE") {
      await autoLiveMarketplaceIfEligible(post.id);
    } else {
      const author = await User.findByPk(post.userId, { attributes: ["community"] });
      emitFeedNewPost(author?.community ?? null, post.id);
    }
    return;
  }

  if (post.safetyDecision === "REVIEW_REQUIRED" || post.safetyDecision === "BLOCKED") {
    if (post.postType === "MARKETPLACE") {
      await holdMarketplaceForSafetyReview(post.id);
    }
    return;
  }

  if (post.safetyDecision !== "PENDING" && post.safetyDecision !== "PROCESSING") {
    return;
  }

  if (!postHasMedia(post)) {
    const text = moderateText(`${post.title}\n${post.description ?? ""}`);
    if (text.verdict === "SAFE") {
      await tryPublishIfEligible(post.id, post.mediaVersion || 1, {
        category: "SAFE",
        confidence: 1,
        model: "text",
        modelVersion: "v1",
        policyVersion: CONTENT_SAFETY_POLICY_VERSION,
        reason: "TEXT_ONLY_CREATE"
      });
    }
    return;
  }

  try {
    const mediaRows = await findMediaFilesForPost(post);
    const quarantineMedia = mediaRows.filter((m) =>
      (QUARANTINE_MEDIA_MODULES as readonly string[]).includes(m.module)
    );
    if (!quarantineMedia.length) {
      logSafety("moderation_waiting_media", { post_id: post.id });
    } else {
      const primaryKey = post.mediaUrl ? extractR2KeyFromUrl(post.mediaUrl) ?? post.mediaUrl : null;
      const primary =
        quarantineMedia.find(
          (m) =>
            m.objectKey === primaryKey ||
            m.fileUrl === primaryKey ||
            m.objectKey === post.mediaUrl ||
            m.fileUrl === post.mediaUrl
        ) ?? quarantineMedia[0]!;

      // Worker still optimizing — it will call moderateProcessedMedia when done.
      if (primary.processingStatus !== "completed" && !primary.safetyDecision) {
        logSafety("moderation_waiting_worker", {
          post_id: post.id,
          media_id: primary.id,
          processing: primary.processingStatus
        });
      } else {
        const applied = await applyCachedMediaSafetyToPost(post, primary);
        if (!applied) {
          // Rare: completed job but no usable decision — rescan in background (do not block create).
          logSafety("moderation_background_rescan", {
            post_id: post.id,
            media_id: primary.id
          });
          void moderateProcessedMedia(primary.id, null).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            logSafety("moderation_background_rescan_failed", {
              post_id: post.id,
              media_id: primary.id,
              error: message.slice(0, 200)
            });
          });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logSafety("moderation_reconcile_failed", {
      post_id: post.id,
      error: message.slice(0, 200)
    });
    // Leave PENDING — worker/admin can finish. Do not auto-allow on unknown errors.
  }

  // Create race: media already finished before the post existed, or staging↔full key
  // mismatch left the post PENDING. Re-apply from media_files / re-run moderation.
  await post.reload();
  if (
    (post.safetyDecision === "PENDING" || post.safetyDecision === "PROCESSING") &&
    postHasMedia(post)
  ) {
    void reconcilePendingPostSafety(post.id).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSafety("moderation_post_reconcile_failed", {
        post_id: post.id,
        error: message.slice(0, 200)
      });
    });
  }
}

function postHasMedia(post: Post): boolean {
  return Boolean(
    post.mediaUrl ||
      post.thumbnailUrl ||
      (Array.isArray(post.marketplaceGallery) && post.marketplaceGallery.length > 0) ||
      (Array.isArray(post.helpGallery) && post.helpGallery.length > 0)
  );
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
  if (
    post.postType === "MARKETPLACE" &&
    (next.safetyDecision === "REVIEW_REQUIRED" || next.safetyDecision === "BLOCKED")
  ) {
    await holdMarketplaceForSafetyReview(post.id);
  }
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

function candidateVideoKeys(key: string, variantsJson?: string | null): string[] {
  const keys: string[] = [];
  const add = (k: string | null | undefined) => {
    if (!k || keys.includes(k)) return;
    keys.push(k);
  };
  add(key);
  add(publishedKeyFromQuarantine(key));
  if (variantsJson) {
    try {
      const parsed = JSON.parse(variantsJson) as Record<string, unknown>;
      if (typeof parsed.video === "string") {
        add(parsed.video);
        add(publishedKeyFromQuarantine(parsed.video));
      }
    } catch {
      /* ignore */
    }
  }
  return keys;
}

function posterKeysFromVariants(variantsJson?: string | null): string[] {
  if (!variantsJson) return [];
  try {
    const parsed = JSON.parse(variantsJson) as Record<string, unknown>;
    const keys: string[] = [];
    const add = (v: unknown) => {
      if (typeof v !== "string") return;
      if (!v.includes("_poster_") || !/\.(webp|jpe?g|png)$/i.test(v)) return;
      if (!keys.includes(v)) keys.push(v);
      const published = publishedKeyFromQuarantine(v);
      if (published && !keys.includes(published)) keys.push(published);
    };
    for (const field of ["full", "medium", "thumb"] as const) {
      add(parsed[field]);
    }
    return keys;
  } catch {
    return [];
  }
}

function isMissingR2KeyError(err: unknown): boolean {
  const status = Number(
    (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0
  );
  if (status === 404) return true;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return name === "NoSuchKey" || /specified key does not exist/i.test(msg) || /nosuchkey/i.test(msg);
}

async function classifyVideoFromR2(
  key: string,
  maxBytes: number,
  variantsJson?: string | null
): Promise<{ evaluation: PolicyEvaluation; result: NormalizedModerationResult }> {
  const tmp = await createMediaTempDirectory("dh-mod-");
  const videoKeys = candidateVideoKeys(key, variantsJson);
  let lastDownloadErr: unknown;
  try {
    for (let i = 0; i < videoKeys.length; i++) {
      const videoKey = videoKeys[i]!;
      const inPath = path.join(tmp, `in-${i}.bin`);
      try {
        await downloadR2ObjectToFile(videoKey, inPath, maxBytes);
        const { frames, plan } = await extractModerationFramesFromPath(inPath);
        return classifyVideoFrames(frames, plan);
      } catch (downloadErr) {
        lastDownloadErr = downloadErr;
        console.warn(
          `[moderation] video key miss/fail ${videoKey}: ${
            downloadErr instanceof Error ? downloadErr.message : downloadErr
          }`
        );
        if (!isMissingR2KeyError(downloadErr) && i === videoKeys.length - 1) {
          break;
        }
      }
    }

    // Community speech / event videos: if the mp4 GET fails after optimize (or quarantine
    // already promoted), fall back to poster WebPs so content can still reach SAFE.
    const posterKeys = posterKeysFromVariants(variantsJson);
    if (!posterKeys.length) {
      throw lastDownloadErr ?? new Error("VIDEO_DOWNLOAD_FAILED");
    }
    console.warn(
      `[moderation] video download failed for ${key}; falling back to ${posterKeys.length} poster frame(s)`
    );
    const frames: Buffer[] = [];
    const imageMax = Number(process.env.MODERATION_MAX_IMAGE_SIZE || 2_000_000);
    for (const posterKey of posterKeys) {
      try {
        frames.push(await getR2ObjectBuffer(posterKey, imageMax));
      } catch (posterErr) {
        console.warn(
          `[moderation] poster fetch failed ${posterKey}:`,
          posterErr instanceof Error ? posterErr.message : posterErr
        );
      }
    }
    if (!frames.length) {
      throw lastDownloadErr ?? new Error("VIDEO_DOWNLOAD_FAILED");
    }
    return classifyVideoFrames(frames, { insufficientCoverage: false });
  } finally {
    await removeMediaTempDirectory(tmp);
  }
}

async function postsReferencingMedia(media: MediaFile): Promise<Post[]> {
  const keys = new Set<string>();
  const addKey = (raw: string | null | undefined) => {
    if (!raw) return;
    const k = extractR2KeyFromUrl(raw) ?? raw;
    if (!k) return;
    keys.add(k);
    const published = publishedKeyFromQuarantine(k);
    if (published) keys.add(published);
    for (const artifact of collectMediaArtifactKeys(k, media.variantsJson)) {
      keys.add(artifact);
      const pub = publishedKeyFromQuarantine(artifact);
      if (pub) keys.add(pub);
    }
  };

  addKey(media.objectKey);
  addKey(media.fileUrl);
  if (keys.size === 0) return [];

  const keyList = [...keys];
  const or = keyList.flatMap((key) => [{ mediaUrl: key }, { thumbnailUrl: key }]);
  const byUrl = await Post.findAll({
    where: {
      userId: media.userId,
      [Op.or]: or
    },
    limit: 50
  });

  const foundIds = new Set(byUrl.map((p) => p.id));

  // Marketplace / help often keep the upload key only in gallery JSON; also catch
  // staging→_full rewrite when mediaUrl was not rewritten yet.
  const galleryCandidates = await Post.findAll({
    where: {
      userId: media.userId,
      postType: { [Op.in]: ["MARKETPLACE", "HELP_REQUEST"] },
      ...(foundIds.size ? { id: { [Op.notIn]: [...foundIds] } } : {})
    },
    order: [["updatedAt", "DESC"]],
    limit: 40
  });

  const galleryHits = galleryCandidates.filter((p) => {
    const urls =
      p.postType === "MARKETPLACE"
        ? parseMarketplaceGallery(p.marketplaceGallery, p.mediaUrl)
        : parseHelpGallery(p.helpGallery, p.mediaUrl);
    for (const u of urls) {
      const k = extractR2KeyFromUrl(u) ?? u;
      if (keys.has(k)) return true;
      for (const artifact of collectMediaArtifactKeys(k, null)) {
        if (keys.has(artifact)) return true;
      }
    }
    return false;
  });

  return [...byUrl, ...galleryHits];
}

function mediaBasenameToken(keyOrUrl: string | null | undefined): string | null {
  if (!keyOrUrl) return null;
  const k = extractR2KeyFromUrl(keyOrUrl) ?? keyOrUrl;
  const base = path.posix
    .basename(k)
    .replace(/_full\.webp$/i, "")
    .replace(/_md\.webp$/i, "")
    .replace(/_thumb\.webp$/i, "")
    .replace(/\.[^.]+$/, "");
  return base.length >= 6 ? base : null;
}

/** When exact key match fails (staging deleted / gallery not rewritten), link by filename stem. */
async function findPendingPostsMatchingMediaBasename(media: MediaFile): Promise<Post[]> {
  const token = mediaBasenameToken(media.objectKey || media.fileUrl);
  if (!token) return [];
  const postType =
    media.module === "marketplace"
      ? "MARKETPLACE"
      : media.module === "help"
        ? "HELP_REQUEST"
        : media.module === "jobs"
          ? "JOB"
          : null;
  if (!postType) return [];
  const recent = await Post.findAll({
    where: {
      userId: media.userId,
      postType,
      safetyDecision: { [Op.in]: ["PENDING", "PROCESSING"] },
      createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    order: [["createdAt", "DESC"]],
    limit: 20
  });
  return recent.filter((p) => {
    const urls =
      p.postType === "MARKETPLACE"
        ? parseMarketplaceGallery(p.marketplaceGallery, p.mediaUrl)
        : p.postType === "HELP_REQUEST"
          ? parseHelpGallery(p.helpGallery, p.mediaUrl)
          : [p.mediaUrl, p.thumbnailUrl];
    const blob = [p.mediaUrl, p.thumbnailUrl, ...urls].filter(Boolean).join("\n");
    return blob.includes(token);
  });
}

async function findMediaFilesByBasenameFallback(post: Post): Promise<MediaFile[]> {
  const tokens = new Set<string>();
  for (const raw of mediaKeysForPost(post)) {
    const t = mediaBasenameToken(raw);
    if (t) tokens.add(t);
  }
  if (!tokens.size) return [];
  const recent = await MediaFile.findAll({
    where: {
      userId: post.userId,
      module: { [Op.in]: [...QUARANTINE_MEDIA_MODULES] },
      createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    order: [["id", "DESC"]],
    limit: 40
  });
  return recent.filter((m) => {
    const key = `${m.objectKey || ""}\n${m.fileUrl || ""}`;
    return [...tokens].some((t) => key.includes(t));
  });
}

/**
 * Repair posts stuck on PENDING/PROCESSING after media already finished
 * (create-after-moderate race or staging↔full key mismatch). Not sexual — link bug.
 */
export async function reconcilePendingPostSafety(postId: number): Promise<boolean> {
  const post = await Post.findByPk(postId);
  if (!post) return false;
  if (post.safetyDecision !== "PENDING" && post.safetyDecision !== "PROCESSING") {
    return false;
  }

  if (!postHasMedia(post)) {
    const text = moderateText(`${post.title}\n${post.description ?? ""}`);
    if (text.verdict !== "SAFE") return false;
    return tryPublishIfEligible(post.id, post.mediaVersion || 1, {
      category: "SAFE",
      confidence: 1,
      model: "text",
      modelVersion: "v1",
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      reason: "RECONCILE_TEXT_ONLY"
    });
  }

  let mediaRows = await findMediaFilesForPost(post);
  if (!mediaRows.length) {
    mediaRows = await findMediaFilesByBasenameFallback(post);
  }

  const decided = mediaRows.find(
    (m) =>
      (QUARANTINE_MEDIA_MODULES as readonly string[]).includes(m.module) &&
      m.safetyDecision &&
      m.safetyDecision !== "PENDING" &&
      m.safetyDecision !== "PROCESSING"
  );
  if (decided) {
    const applied = await applyCachedMediaSafetyToPost(post, decided);
    if (applied) {
      logSafety("moderation_post_reconciled_from_media", {
        post_id: post.id,
        media_id: decided.id,
        decision: decided.safetyDecision
      });
      return true;
    }
  }

  const completed = mediaRows.find(
    (m) =>
      (QUARANTINE_MEDIA_MODULES as readonly string[]).includes(m.module) &&
      m.processingStatus === "completed"
  );
  if (completed) {
    await moderateProcessedMedia(completed.id, null);
    const refreshed = await Post.findByPk(postId);
    const done =
      refreshed?.safetyDecision === "SAFE" ||
      refreshed?.safetyDecision === "REVIEW_REQUIRED" ||
      refreshed?.safetyDecision === "BLOCKED";
    if (done) {
      logSafety("moderation_post_reconciled_rescan", {
        post_id: postId,
        media_id: completed.id,
        decision: refreshed?.safetyDecision
      });
    }
    return Boolean(done);
  }

  return false;
}

/** Batch repair for stuck PENDING help/marketplace/job posts (ops / scheduler). */
export async function reconcileStuckPendingPosts(
  limit = 40
): Promise<{ scanned: number; fixed: number }> {
  const stuck = await Post.findAll({
    where: {
      safetyDecision: { [Op.in]: ["PENDING", "PROCESSING"] },
      postType: { [Op.in]: ["HELP_REQUEST", "MARKETPLACE", "JOB"] },
      createdAt: { [Op.lt]: new Date(Date.now() - 45_000) }
    },
    order: [["id", "ASC"]],
    limit: Math.min(100, Math.max(1, limit))
  });
  let fixed = 0;
  for (const p of stuck) {
    try {
      if (await reconcilePendingPostSafety(p.id)) fixed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logSafety("moderation_stuck_reconcile_error", {
        post_id: p.id,
        error: message.slice(0, 200)
      });
    }
  }
  return { scanned: stuck.length, fixed };
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
  if (post.postType === "MARKETPLACE") {
    await autoLiveMarketplaceIfEligible(post.id);
  } else {
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
      const classified = await classifyVideoFromR2(key, maxBytes, media.variantsJson);
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
    const failureReason =
      err instanceof Error ? err.message.slice(0, 200) : "DOWNLOAD_FAILED";
    // Download / network failures are NOT corrupt media — keep fail-closed REVIEW
    // but do not stamp CORRUPTED_MEDIA (misleading for ops and admins).
    evaluation = evaluateModeration({
      available: false,
      category: "UNCERTAIN",
      confidence: null,
      failed: true,
      timeout: false,
      corrupt: false,
      unsupported: false,
      insufficientCoverage: false,
      modelName: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      failureReason
    });
    result = {
      available: false,
      category: "UNCERTAIN",
      confidence: null,
      failed: true,
      timeout: false,
      corrupt: false,
      unsupported: false,
      insufficientCoverage: false,
      modelName: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      failureReason
    };
  }

  evaluation = allowNonSexualUncertainty(evaluation, result);
  if (evaluation.reason === "AUTO_ALLOW_NON_SEXUAL_UNCERTAIN") {
    logSafety("moderation_auto_allow_uncertain", {
      media_id: mediaId,
      job_id: jobId,
      original_failure: result.failureReason ?? null
    });
  }

  const decision = policyVerdictToSafetyDecision(evaluation.verdict);
  const processingTimeMs = Date.now() - started;
  const postsFromKeys = await postsReferencingMedia(media);
  const postsBasename =
    postsFromKeys.length === 0 ? await findPendingPostsMatchingMediaBasename(media) : [];
  const posts = postsFromKeys.length ? postsFromKeys : postsBasename;
  if (!postsFromKeys.length && postsBasename.length) {
    logSafety("moderation_posts_linked_by_basename", {
      media_id: mediaId,
      job_id: jobId,
      post_ids: postsBasename.map((p) => p.id)
    });
  } else if (!posts.length) {
    logSafety("moderation_no_posts_linked", {
      media_id: mediaId,
      job_id: jobId,
      module: media.module,
      object_key: media.objectKey
    });
  }

  await media.update({
    safetyDecision: decision,
    safetyCategory: evaluation.category === "UNCERTAIN" && decision === "SAFE" ? "SAFE" : evaluation.category,
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
        if (post.postType === "MARKETPLACE") {
          await holdMarketplaceForSafetyReview(post.id);
        }
        // REVIEW_REQUIRED still skips public promote — but posts must not keep deleted staging keys.
        const liveKey = media.objectKey || extractR2KeyFromUrl(media.fileUrl);
        if (liveKey) {
          const stagingMap = new Map<string, string>();
          for (const raw of [post.mediaUrl, post.thumbnailUrl]) {
            if (!raw) continue;
            const from = extractR2KeyFromUrl(raw) ?? raw;
            if (from !== liveKey) stagingMap.set(from, liveKey);
          }
          if (stagingMap.size > 0) {
            await sequelize.transaction(async (transaction) => {
              const locked = await Post.findByPk(post.id, {
                transaction,
                lock: Transaction.LOCK.UPDATE
              });
              if (!locked || locked.mediaVersion !== post.mediaVersion) return;
              await rewritePostMediaKeys(locked, stagingMap, transaction);
            });
          }
        }
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
          {
            objectKey: nextKey,
            fileUrl: nextFileUrl ?? media.fileUrl,
            variantsJson: nextVariants,
            safetyDecision: "SAFE",
            safetyCategory:
              evaluation.category === "UNCERTAIN" ? "SAFE" : evaluation.category
          },
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
  // Pipeline errors are not sexual content — auto-allow linked posts when caption is clean.
  await media.update({ safetyDecision: "SAFE", safetyCategory: "SAFE" });
  const postsFromKeys = await postsReferencingMedia(media);
  const postsBasename =
    postsFromKeys.length === 0 ? await findPendingPostsMatchingMediaBasename(media) : [];
  const posts = postsFromKeys.length ? postsFromKeys : postsBasename;
  for (const post of posts) {
    const text = moderateText(`${post.title}\n${post.description ?? ""}`);
    if (text.verdict !== "SAFE") {
      await Post.update(
        {
          safetyDecision: "REVIEW_REQUIRED",
          safetyCategory: text.category,
          safetyFailureReason: text.reason.slice(0, 255),
          moderatedMediaVersion: null
        } as any,
        { where: { id: post.id, mediaVersion: post.mediaVersion } }
      );
      if (post.postType === "MARKETPLACE") await holdMarketplaceForSafetyReview(post.id);
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
    });
    const published = await tryPublishIfEligible(post.id, post.mediaVersion, {
      category: "SAFE",
      confidence: null,
      model: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      reason: "AUTO_ALLOW_PIPELINE_ERROR"
    });
    if (published) await deletePromotedQuarantineKeys(mapping);
    await writeScan({
      postId: post.id,
      mediaId,
      jobId,
      mediaVersion: post.mediaVersion,
      mediaType: media.fileType,
      model: LOCAL_MODEL_NAME,
      modelVersion: LOCAL_MODEL_VERSION,
      policyVersion: CONTENT_SAFETY_POLICY_VERSION,
      status: "SAFE",
      category: "SAFE",
      confidence: null,
      decision: "SAFE",
      failureReason: `AUTO_ALLOW_PIPELINE_ERROR:${reason}`.slice(0, 240),
      processingTimeMs: null
    });
    logSafety("moderation_auto_allow_pipeline_error", {
      post_id: post.id,
      media_id: mediaId,
      job_id: jobId,
      reason: reason.slice(0, 120),
      published
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
  const { mediaService } = await import("../Media.service");
  const mapping = await mediaService.buildPostMediaPublishMapping(post);
  const mediaFiles: MediaFile[] = [];
  for (const seed of [post.mediaUrl, post.thumbnailUrl]) {
    if (!seed) continue;
    const row = await mediaService.findMediaFileForPostReference(post.userId, seed);
    if (row && !mediaFiles.some((m) => m.id === row.id)) mediaFiles.push(row);
  }
  const ok = await sequelize.transaction(async (transaction) => {
    const locked = await Post.findByPk(postId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!locked) return false;
    if (locked.mediaVersion !== expectedMediaVersion) return false;
    if (locked.deletedAt || locked.moderationStatus === "SOFT_DELETED") return false;
    await rewritePostMediaKeys(locked, mapping, transaction);
    // Video posts often had thumbnailUrl = video key; prefer poster after publish.
    const primaryMedia = mediaFiles[0] ?? null;
    if (locked.mediaType === "video" && primaryMedia) {
      const poster = mediaService.preferredVideoThumbnailKey(
        primaryMedia,
        locked.thumbnailUrl
      );
      if (poster && poster !== locked.thumbnailUrl) {
        await locked.update({ thumbnailUrl: poster } as any, { transaction });
      }
    }
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
  // Critical: media_files must move off deleted quarantine keys or feed resolveLiveMediaKey
  // returns private paths and toPublicUrlIfR2 → null (video card with no playable URL).
  await mediaService.applyPublishMappingToMediaFiles(mediaFiles, mapping);
  try {
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
  } catch (auditErr) {
    // Post is already SAFE + public keys rewritten; do not roll that back on audit ENUM/schema gaps.
    console.warn(
      `[content-safety] SAFETY_ALLOW audit log failed post=${postId}:`,
      auditErr instanceof Error ? auditErr.message : auditErr
    );
  }
  await deletePromotedQuarantineKeys(mapping);
  const refreshed = await Post.findByPk(postId);
  if (refreshed?.postType === "MARKETPLACE") {
    await autoLiveMarketplaceIfEligible(postId);
  } else {
    const author = await User.findByPk(post.userId, { attributes: ["community"] });
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
  await holdMarketplaceForSafetyReview(postId);
  const post = await Post.findByPk(postId);
  try {
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
  } catch (auditErr) {
    console.warn(
      `[content-safety] SAFETY_REJECT audit log failed post=${postId}:`,
      auditErr instanceof Error ? auditErr.message : auditErr
    );
  }
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
