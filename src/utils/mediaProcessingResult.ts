import type { MediaFile } from "../models";
import {
  isPrivateR2Object,
  toPublicUrlIfR2,
  toStorageKeyIfR2
} from "./r2Client";

export type MediaVariantsDto = {
  thumb: string;
  medium: string;
  full: string;
};

export type FinalizeMediaResult = {
  mediaFileId: number;
  publicUrl: string;
  variants: MediaVariantsDto;
  width: number;
  height: number;
  byteSize: number;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  mediaType?: "image" | "video";
};

export function toDeliveryVariants(
  stored: MediaVariantsDto,
  isPrivate: boolean
): MediaVariantsDto {
  if (isPrivate) {
    return {
      thumb: toStorageKeyIfR2(stored.thumb) ?? stored.thumb,
      medium: toStorageKeyIfR2(stored.medium) ?? stored.medium,
      full: toStorageKeyIfR2(stored.full) ?? stored.full
    };
  }
  return {
    thumb: toPublicUrlIfR2(stored.thumb) ?? stored.thumb,
    medium: toPublicUrlIfR2(stored.medium) ?? stored.medium,
    full: toPublicUrlIfR2(stored.full) ?? stored.full
  };
}

export function getCompletedMediaResult(row: MediaFile): FinalizeMediaResult | null {
  if (row.processingStatus !== "completed" || !row.variantsJson) return null;
  const isPrivate = isPrivateR2Object(row.objectKey ?? row.fileUrl);
  let stored: MediaVariantsDto & { durationSec?: number | null };
  try {
    const parsed = JSON.parse(row.variantsJson) as Partial<MediaVariantsDto> & {
      durationSec?: number | null;
    };
    if (
      typeof parsed.thumb !== "string" ||
      typeof parsed.medium !== "string" ||
      typeof parsed.full !== "string"
    ) {
      return null;
    }
    stored = {
      thumb: parsed.thumb,
      medium: parsed.medium,
      full: parsed.full,
      durationSec: parsed.durationSec
    };
  } catch {
    return null;
  }
  const variants = toDeliveryVariants(
    stored,
    isPrivate
  );
  const publicUrl = isPrivate
    ? toStorageKeyIfR2(row.fileUrl) ?? row.fileUrl
    : toPublicUrlIfR2(row.fileUrl) ?? row.fileUrl;
  return {
    mediaFileId: row.id,
    publicUrl,
    variants,
    width: row.width ?? 0,
    height: row.height ?? 0,
    byteSize: row.byteSize ?? 0,
    ...(row.fileType === "video"
      ? {
          thumbnailUrl: variants.medium || variants.thumb || null,
          durationSec: stored.durationSec ?? null,
          mediaType: "video" as const
        }
      : { mediaType: "image" as const })
  };
}
