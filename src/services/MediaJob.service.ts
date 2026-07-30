import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/db";
import { MediaFile, MediaJob } from "../models";
import type { MediaProcessingStatus } from "../models";
import {
  extractR2KeyFromUrl,
  getR2ObjectMetadata,
  isPrivateR2Object,
  toPublicUrlIfR2,
  toStorageKeyIfR2
} from "../utils/r2Client";
import {
  getCompletedMediaResult,
  type FinalizeMediaResult
} from "../utils/mediaProcessingResult";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "../validations/media.validation";

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
};

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
  return {
    ...(completed ?? provisionalResult(row, byteSize)),
    processingStatus:
      job?.status === "failed"
        ? "failed"
        : job?.status === "completed"
          ? "completed"
          : row.processingStatus,
    jobId: job?.id ?? null,
    ...(job?.status === "failed" ? { errorMessage: job.errorMessage } : {})
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
  const current = await ownedMedia(mediaFileId, userId);
  const completed = getCompletedMediaResult(current);
  if (completed) {
    const job = await MediaJob.findOne({ where: { mediaId: current.id } });
    return stateFor(current, job);
  }

  const objectKey = current.objectKey ?? extractR2KeyFromUrl(current.fileUrl);
  if (!objectKey) {
    throw Object.assign(new Error("Invalid media storage key"), { status: 400 });
  }
  const metadata = await getR2ObjectMetadata(objectKey);
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

  return stateFor(result.row, result.job, metadata.byteSize);
}

export async function getMediaFinalizeStatus(
  mediaFileId: number,
  userId: number
): Promise<MediaFinalizeState> {
  const row = await ownedMedia(mediaFileId, userId);
  const job = await MediaJob.findOne({ where: { mediaId: row.id } });
  return stateFor(row, job);
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
      ]
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
    const { mediaProcessingService } = await import("./MediaProcessing.service");
    const processed = await mediaProcessingService.processMediaFile(job.mediaId);
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
    if (!completed) {
      console.warn(`[media-worker] lost claim before completion job=${job.id}`);
    }
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
