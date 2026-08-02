import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/db";
import { MediaFile, MediaJob } from "../models";
import type { MediaProcessingStatus } from "../models";
import {
  extractR2KeyFromUrl,
  getR2ObjectMetadata,
  getR2ObjectPrefix,
  isPrivateR2Object,
  toPublicUrlIfR2,
  toStorageKeyIfR2
} from "../utils/r2Client";
import {
  getCompletedMediaResult,
  type FinalizeMediaResult
} from "../utils/mediaProcessingResult";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, ALLOWED_IMAGE_MIMES } from "../validations/media.validation";
import {
  ALLOWED_POST_VIDEO_MIMES,
  LEGACY_POST_VIDEO_MIMES
} from "../constants/postMedia.constants";
import {
  detectMediaMimeFromBytes,
  guessMimeFromObjectKey,
  isExecutableOrScriptMagic
} from "../utils/mediaMagic.util";

const ALLOWED_FINALIZE_VIDEO_MIMES = new Set<string>([
  ...ALLOWED_POST_VIDEO_MIMES,
  ...LEGACY_POST_VIDEO_MIMES
]);

function isAllowedFinalizeContentType(fileType: string, contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase().split(";")[0].trim();
  if (fileType === "image") {
    return (ALLOWED_IMAGE_MIMES as Set<string>).has(lower);
  }
  if (fileType === "video") {
    return ALLOWED_FINALIZE_VIDEO_MIMES.has(lower);
  }
  return false;
}

/** Resolve effective Content-Type: HEAD → magic bytes → object-key extension. */
async function resolveFinalizeContentType(
  fileType: string,
  objectKey: string,
  headContentType: string | null
): Promise<string> {
  if (headContentType && isAllowedFinalizeContentType(fileType, headContentType)) {
    return headContentType.toLowerCase().split(";")[0].trim();
  }

  let prefix: Buffer = Buffer.alloc(0);
  try {
    prefix = await getR2ObjectPrefix(objectKey, 512);
  } catch {
    prefix = Buffer.alloc(0);
  }

  if (prefix.length > 0 && isExecutableOrScriptMagic(prefix)) {
    throw Object.assign(new Error("Uploaded object looks like an executable or script"), {
      status: 400
    });
  }

  const sniffed = prefix.length > 0 ? detectMediaMimeFromBytes(prefix) : null;
  if (sniffed && isAllowedFinalizeContentType(fileType, sniffed)) {
    return sniffed;
  }

  const fromKey = guessMimeFromObjectKey(objectKey, fileType);
  if (fromKey && isAllowedFinalizeContentType(fileType, fromKey)) {
    // Prefer extension only when HEAD was empty/unknown — still reject exe magic above
    return fromKey;
  }

  throw Object.assign(new Error(`Uploaded object is not a valid ${fileType}`), { status: 400 });
}

const MAX_RETRIES = 3;
const configuredMaxStaleRecoveries = Number(
  process.env.MEDIA_JOB_MAX_STALE_RECOVERIES || 10
);
const MAX_STALE_RECOVERIES = Number.isFinite(configuredMaxStaleRecoveries)
  ? Math.max(1, Math.floor(configuredMaxStaleRecoveries))
  : 10;
const configuredStaleMs = Number(process.env.MEDIA_JOB_STALE_MS || 15 * 60_000);
const STALE_PROCESSING_MS = Number.isFinite(configuredStaleMs)
  ? Math.max(4 * 60_000, configuredStaleMs)
  : 15 * 60_000;

export type MediaFinalizeState = FinalizeMediaResult & {
  processingStatus: MediaProcessingStatus;
  jobId: number | null;
  errorMessage?: string | null;
  /** Present when a job is queued/unclaimed — helps diagnose a missing media worker. */
  queue?: {
    jobStatus: string;
    ageMs: number;
    claimed: boolean;
    hint?: string;
  };
};

function mediaTimingEnabled(): boolean {
  return process.env.MEDIA_PIPELINE_TIMING === "true";
}

function mediaTimingLog(step: string, ms: number, extra?: Record<string, unknown>): void {
  if (!mediaTimingEnabled() && ms < 3000) return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[media-pipeline] ${step}=${ms}ms${suffix}`);
}

function queueDiagnostics(
  job: MediaJob | null,
  processingStatus: MediaProcessingStatus
): MediaFinalizeState["queue"] | undefined {
  if (!job) return undefined;
  if (job.status === "completed" || processingStatus === "completed") return undefined;
  if (job.status === "failed" || processingStatus === "failed") return undefined;
  const ageMs = Math.max(0, Date.now() - new Date(job.updatedAt).getTime());
  const claimed = job.status === "processing" && !!job.workerId;
  const stuckUnclaimed = job.status === "pending" && !job.workerId && ageMs >= 5_000;
  return {
    jobStatus: job.status,
    ageMs,
    claimed,
    ...(stuckUnclaimed
      ? {
          hint:
            "Media job is still pending with no worker claim. Start the media worker (npm run dev:media-worker / digitalhouse-media-worker)."
        }
      : {})
  };
}

function provisionalResult(row: MediaFile, byteSize = 0): FinalizeMediaResult {
  const raw = row.objectKey ?? row.fileUrl;
  const key = toStorageKeyIfR2(raw) ?? raw;
  const url = isPrivateR2Object(key) ? key : toPublicUrlIfR2(key) ?? key;
  return {
    mediaFileId: row.id,
    publicUrl: url,
    variants: { thumb: url, medium: url, full: url },
    width: row.width ?? 0,
    height: row.height ?? 0,
    byteSize: row.byteSize ?? byteSize,
    thumbnailUrl: row.fileType === "video" ? null : undefined,
    durationSec: row.fileType === "video" ? null : undefined,
    mediaType: row.fileType
  };
}

function stateFor(
  row: MediaFile,
  job: MediaJob | null,
  byteSize = 0
): MediaFinalizeState {
  const completed = getCompletedMediaResult(row);
  const processingStatus: MediaProcessingStatus =
    job?.status === "failed"
      ? "failed"
      : job?.status === "completed"
        ? "completed"
        : row.processingStatus;
  const queue = queueDiagnostics(job, processingStatus);
  return {
    ...(completed ?? provisionalResult(row, byteSize)),
    processingStatus,
    jobId: job?.id ?? null,
    ...(job?.status === "failed" ? { errorMessage: job.errorMessage } : {}),
    ...(queue ? { queue } : {})
  };
}

async function ownedMedia(mediaFileId: number, userId: number): Promise<MediaFile> {
  const row = await MediaFile.findByPk(mediaFileId);
  if (!row) throw Object.assign(new Error("Media not found"), { status: 404 });
  if (row.userId !== userId) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return row;
}

/**
 * Validate the direct R2 upload, enqueue one durable job, and return immediately.
 * The provisional URL fields preserve compatibility for older mobile clients.
 */
export async function enqueueMediaFinalize(
  mediaFileId: number,
  userId: number
): Promise<MediaFinalizeState> {
  const t0 = Date.now();
  const current = await ownedMedia(mediaFileId, userId);
  const completed = getCompletedMediaResult(current);
  if (completed) {
    const job = await MediaJob.findOne({ where: { mediaId: current.id } });
    mediaTimingLog("finalize.already_completed", Date.now() - t0, { mediaFileId });
    return stateFor(current, job);
  }

  const objectKey = current.objectKey ?? extractR2KeyFromUrl(current.fileUrl);
  if (!objectKey) {
    throw Object.assign(new Error("Invalid media storage key"), { status: 400 });
  }
  const tHead = Date.now();
  const metadata = await getR2ObjectMetadata(objectKey);
  mediaTimingLog("finalize.head_object", Date.now() - tHead, { mediaFileId });
  if (metadata.byteSize <= 0) {
    throw Object.assign(new Error("Uploaded media object is empty"), { status: 400 });
  }
  const maxBytes = current.fileType === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (metadata.byteSize > maxBytes) {
    throw Object.assign(
      new Error(
        `${current.fileType === "image" ? "Image" : "Video"} exceeds the allowed upload size`
      ),
      { status: 400 }
    );
  }
  const expectedType = current.fileType === "image" ? "image/" : "video/";
  if (metadata.contentType && !metadata.contentType.toLowerCase().startsWith(expectedType)) {
    throw Object.assign(new Error(`Uploaded object is not a valid ${current.fileType}`), {
      status: 400
    });
  }
  await resolveFinalizeContentType(current.fileType, objectKey, metadata.contentType);

  const tTx = Date.now();
  const result = await sequelize.transaction(async (transaction) => {
    const row = await MediaFile.findByPk(mediaFileId, {
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (!row) throw Object.assign(new Error("Media not found"), { status: 404 });
    if (row.userId !== userId) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }

    let job = await MediaJob.findOne({
      where: { mediaId: row.id },
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (!job) {
      job = await MediaJob.create(
        {
          mediaId: row.id,
          objectKey,
          jobType: row.fileType,
          status: "pending",
          retryCount: 0,
          staleRecoveryCount: 0,
          errorMessage: null,
          workerId: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        { transaction }
      );
      await row.update(
        { processingStatus: "pending", byteSize: metadata.byteSize },
        { transaction }
      );
    } else if (
      job.status === "failed" ||
      (job.status === "completed" && row.processingStatus !== "completed")
    ) {
      await job.update(
        {
          objectKey,
          jobType: row.fileType,
          status: "pending",
          retryCount: 0,
          staleRecoveryCount: 0,
          errorMessage: null,
          workerId: null,
          startedAt: null,
          completedAt: null
        },
        { transaction }
      );
      await row.update(
        { processingStatus: "pending", byteSize: metadata.byteSize },
        { transaction }
      );
    }
    return { row, job };
  });
  mediaTimingLog("finalize.enqueue_tx", Date.now() - tTx, {
    mediaFileId,
    jobId: result.job.id,
    jobStatus: result.job.status
  });
  mediaTimingLog("finalize.total", Date.now() - t0, {
    mediaFileId,
    jobId: result.job.id
  });

  return stateFor(result.row, result.job, metadata.byteSize);
}

const statusUnclaimedWarnAt = new Map<number, number>();

export async function getMediaFinalizeStatus(
  mediaFileId: number,
  userId: number
): Promise<MediaFinalizeState> {
  const t0 = Date.now();
  const row = await ownedMedia(mediaFileId, userId);
  const job = await MediaJob.findOne({ where: { mediaId: row.id } });
  const state = stateFor(row, job);
  if (state.queue?.hint) {
    const last = statusUnclaimedWarnAt.get(mediaFileId) ?? 0;
    if (Date.now() - last >= 30_000) {
      statusUnclaimedWarnAt.set(mediaFileId, Date.now());
      console.warn(
        `[media] status media=${mediaFileId} pending_unclaimed ageMs=${state.queue.ageMs} — ${state.queue.hint}`
      );
    }
  } else {
    statusUnclaimedWarnAt.delete(mediaFileId);
  }
  mediaTimingLog("status.poll", Date.now() - t0, {
    mediaFileId,
    processingStatus: state.processingStatus,
    jobStatus: job?.status ?? null
  });
  return state;
}

/** Atomically claim one pending job across any number of worker processes. */
export async function claimNextMediaJob(workerId: string): Promise<MediaJob | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const claimBefore = new Date(Date.now() - 2_000);
    const candidate = await MediaJob.findOne({
      where: {
        status: "pending",
        updatedAt: { [Op.lte]: claimBefore }
      },
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"]
      ],
      // Empty-queue polls are frequent; don't inflate [slow-query] with acquire/RTT noise.
      logging: false
    });
    if (!candidate) return null;
    const claimed = await sequelize.transaction(async (transaction) => {
      const media = await MediaFile.findByPk(candidate.mediaId, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      const current = await MediaJob.findByPk(candidate.id, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      if (
        !current ||
        current.status !== "pending" ||
        current.updatedAt.getTime() > claimBefore.getTime()
      ) {
        return null;
      }
      const now = new Date();
      if (!media) {
        await current.update(
          {
            status: "failed",
            errorMessage: "Media file no longer exists",
            workerId: null,
            startedAt: null,
            completedAt: now,
            updatedAt: now
          },
          { transaction }
        );
        return null;
      }
      await current.update(
        {
          status: "processing",
          workerId,
          startedAt: now,
          completedAt: null,
          errorMessage: null,
          updatedAt: now
        },
        { transaction }
      );
      await media.update({ processingStatus: "processing" }, { transaction });
      return current;
    });
    if (claimed) return claimed;
  }
  return null;
}

export async function processClaimedMediaJob(job: MediaJob): Promise<void> {
  const claimedBy = job.workerId;
  if (!claimedBy) throw new Error(`Media job ${job.id} has no worker claim`);
  const t0 = Date.now();
  mediaTimingLog("worker.claim_start", 0, {
    jobId: job.id,
    mediaId: job.mediaId,
    workerId: claimedBy
  });
  const heartbeat = setInterval(() => {
    void MediaJob.update(
      { updatedAt: new Date() },
      { where: { id: job.id, status: "processing", workerId: claimedBy } }
    ).catch((error) =>
      console.warn(
        `[media-worker] heartbeat failed job=${job.id}:`,
        error instanceof Error ? error.message : error
      )
    );
  }, 30_000);
  heartbeat.unref();
  try {
    // Dynamic import keeps Sharp/FFmpeg modules out of the Express process.
    const tOpt = Date.now();
    const { mediaProcessingService } = await import("./MediaProcessing.service");
    const processed = await mediaProcessingService.processMediaFile(job.mediaId);
    mediaTimingLog("worker.optimize", Date.now() - tOpt, {
      jobId: job.id,
      mediaId: job.mediaId
    });
    const tCommit = Date.now();
    const completed = await sequelize.transaction(async (transaction) => {
      const media = await MediaFile.findByPk(job.mediaId, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      const current = await MediaJob.findByPk(job.id, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      if (
        !current ||
        current.status !== "processing" ||
        current.workerId !== claimedBy
      ) {
        return false;
      }
      if (!media) throw new Error(`Media file ${current.mediaId} not found`);
      const now = new Date();
      await media.update(processed.mediaUpdates, { transaction });
      await current.update(
        {
          status: "completed",
          errorMessage: null,
          completedAt: now,
          updatedAt: now
        },
        { transaction }
      );
      return true;
    });
    mediaTimingLog("worker.db_complete", Date.now() - tCommit, {
      jobId: job.id,
      committed: completed
    });
    if (!completed) {
      console.warn(`[media-worker] lost claim before completion job=${job.id}`);
      return;
    }
    // Staging cleanup only after durable commit + this worker still owns the completed row.
    const keys = processed.keysToDeleteAfterCommit ?? [];
    if (keys.length > 0) {
      const stillOwned = await MediaJob.findByPk(job.id);
      if (
        stillOwned &&
        stillOwned.status === "completed" &&
        stillOwned.workerId === claimedBy
      ) {
        const { deleteR2ObjectByKey } = await import("../utils/r2Client");
        await Promise.all(
          keys.map((key) =>
            deleteR2ObjectByKey(key).catch((error) =>
              console.warn(
                `[media-worker] staging delete failed job=${job.id} key=${key}:`,
                error instanceof Error ? error.message : error
              )
            )
          )
        );
      } else {
        console.warn(
          `[media-worker] skipped staging delete after ownership change job=${job.id}`
        );
      }
    }
    mediaTimingLog("worker.total", Date.now() - t0, {
      jobId: job.id,
      mediaId: job.mediaId
    });
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const outcome = await sequelize.transaction(async (transaction) => {
      const media = await MediaFile.findByPk(job.mediaId, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      const current = await MediaJob.findByPk(job.id, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      if (
        !current ||
        current.status !== "processing" ||
        current.workerId !== claimedBy
      ) {
        return null;
      }
      const permanentlyFailed = current.retryCount >= MAX_RETRIES;
      const retryCount = permanentlyFailed
        ? current.retryCount
        : current.retryCount + 1;
      const now = new Date();
      await current.update(
        {
          status: permanentlyFailed ? "failed" : "pending",
          retryCount,
          errorMessage: message.slice(0, 10_000),
          workerId: permanentlyFailed ? claimedBy : null,
          startedAt: permanentlyFailed ? current.startedAt : null,
          completedAt: permanentlyFailed ? now : null,
          updatedAt: now
        },
        { transaction }
      );
      if (media) {
        await media.update(
          { processingStatus: permanentlyFailed ? "failed" : "pending" },
          { transaction }
        );
      }
      return { permanentlyFailed, retryCount };
    });
    if (!outcome) {
      console.warn(`[media-worker] ignored late failure after claim loss job=${job.id}`);
      return;
    }
    if (outcome.permanentlyFailed) throw error;
    console.warn(
      `[media-worker] job=${job.id} attempt=${outcome.retryCount}/${MAX_RETRIES} failed; retrying: ${message}`
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/** Requeue jobs abandoned by a crashed worker. */
export async function recoverStaleMediaJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const stale = await MediaJob.findAll({
    where: { status: "processing", updatedAt: { [Op.lt]: cutoff } },
    limit: 100,
    order: [["updatedAt", "ASC"]]
  });
  let recovered = 0;
  for (const job of stale) {
    const updated = await sequelize.transaction(async (transaction) => {
      const media = await MediaFile.findByPk(job.mediaId, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      const current = await MediaJob.findByPk(job.id, {
        transaction,
        lock: Transaction.LOCK.UPDATE
      });
      if (
        !current ||
        current.status !== "processing" ||
        current.updatedAt.getTime() >= cutoff.getTime()
      ) {
        return false;
      }
      const staleRecoveryCount = current.staleRecoveryCount + 1;
      const permanentlyAbandoned =
        staleRecoveryCount >= MAX_STALE_RECOVERIES;
      const now = new Date();
      await current.update(
        {
          status: permanentlyAbandoned ? "failed" : "pending",
          staleRecoveryCount,
          errorMessage: permanentlyAbandoned
            ? `Worker abandoned the job ${staleRecoveryCount} times`
            : "Worker stopped before completing the job",
          workerId: null,
          startedAt: null,
          completedAt: permanentlyAbandoned ? now : null,
          updatedAt: now
        },
        { transaction }
      );
      if (media) {
        await media.update(
          { processingStatus: permanentlyAbandoned ? "failed" : "pending" },
          { transaction }
        );
      }
      return true;
    });
    if (!updated) continue;
    recovered += 1;
  }
  return recovered;
}

export const mediaJobService = {
  enqueueMediaFinalize,
  getMediaFinalizeStatus,
  claimNextMediaJob,
  processClaimedMediaJob,
  recoverStaleMediaJobs
};
