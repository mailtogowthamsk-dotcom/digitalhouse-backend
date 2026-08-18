import fs from "fs";
import os from "os";
import path from "path";
import { POST_VIDEO_MAX_BYTES } from "../../constants/postMedia.constants";
import {
  createMediaTempDirectory,
  MEDIA_TEMP_PREFIXES,
  removeMediaTempDirectory
} from "../../utils/mediaTempFiles";
import { extractVideoFrameJpegFromPath, probeVideoFile } from "../../utils/videoProcessor";

export type FramePlan = {
  timestampsSec: number[];
  durationSec: number;
  insufficientCoverage: boolean;
};

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export function planVideoFrameTimestamps(durationSec: number): FramePlan {
  const maxDuration = envInt("MODERATION_MAX_VIDEO_DURATION", 180);
  const maxFrames = Math.max(2, envInt("MODERATION_MAX_FRAMES", 6));
  const interval = Math.max(1, envInt("MODERATION_FRAME_INTERVAL", 5));
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { timestampsSec: [], durationSec: 0, insufficientCoverage: true };
  }
  if (durationSec > maxDuration) {
    return { timestampsSec: [], durationSec, insufficientCoverage: true };
  }
  const count = Math.min(maxFrames, Math.max(2, Math.floor(durationSec / interval) + 1));
  const timestampsSec: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (durationSec * (i + 0.5)) / count;
    timestampsSec.push(Math.max(0.1, Math.min(durationSec - 0.05, t)));
  }
  return {
    timestampsSec,
    durationSec,
    insufficientCoverage: timestampsSec.length < 2
  };
}

function assertSafeTempPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const tmp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tmp + path.sep)) {
    throw new Error("Refusing to read a path outside the process temp directory");
  }
  const dirName = path.basename(path.dirname(resolved));
  if (!MEDIA_TEMP_PREFIXES.some((prefix) => dirName.startsWith(prefix))) {
    throw new Error("Refusing to read a non-media temp path");
  }
}

export async function extractModerationFramesFromPath(inPath: string): Promise<{
  frames: Buffer[];
  plan: FramePlan;
}> {
  assertSafeTempPath(inPath);
  const probe = await probeVideoFile(inPath);
  const plan = planVideoFrameTimestamps(probe.durationSec);
  if (plan.insufficientCoverage) {
    return { frames: [], plan };
  }
  const frames: Buffer[] = [];
  for (const at of plan.timestampsSec) {
    frames.push(await extractVideoFrameJpegFromPath(inPath, at));
  }
  return { frames, plan };
}

export async function extractModerationFrames(videoBuffer: Buffer): Promise<{
  frames: Buffer[];
  plan: FramePlan;
}> {
  const maxBytes = envInt("MODERATION_MAX_VIDEO_BYTES", POST_VIDEO_MAX_BYTES);
  if (videoBuffer.length > maxBytes) {
    return {
      frames: [],
      plan: { timestampsSec: [], durationSec: 0, insufficientCoverage: true }
    };
  }
  const tmp = await createMediaTempDirectory("dh-mod-");
  const inPath = path.join(tmp, "in.bin");
  try {
    await fs.promises.writeFile(inPath, videoBuffer);
    return await extractModerationFramesFromPath(inPath);
  } finally {
    await removeMediaTempDirectory(tmp);
  }
}
