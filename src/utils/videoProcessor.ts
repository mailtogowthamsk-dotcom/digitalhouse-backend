/**
 * Video probe + optional FFmpeg optimize (H.264/AAC/faststart @ ≤720p).
 * Designed for low-RAM hosts: single job, -threads 1, veryfast preset.
 * If ffmpeg/ffprobe are missing, validation falls back to container/MIME checks only.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { POST_VIDEO_MAX_BYTES, POST_VIDEO_MAX_DURATION_SEC, POST_VIDEO_MIN_DURATION_SEC } from "../constants/postMedia.constants";

export type VideoProbeInfo = {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number | null;
  formatName: string;
};

export type OptimizeVideoResult = {
  buffer: Buffer;
  width: number;
  height: number;
  durationSec: number;
  byteSize: number;
  videoCodec: string;
  audioCodec: string;
};

const MAX_EDGE = 720;
/** Soft reject above this before re-encode (bits/sec). */
const MAX_INPUT_BITRATE = 12_000_000;
const processingLocks = new Set<string>();

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return !/^(0|false|no|off)$/i.test(v);
}

/** Default on when binary likely present; disable with VIDEO_OPTIMIZE_ENABLED=0 on tiny hosts. */
export function isVideoOptimizeEnabled(): boolean {
  return envFlag("VIDEO_OPTIMIZE_ENABLED", true);
}

function runCmd(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

let ffmpegAvailable: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable != null) return ffmpegAvailable;
  try {
    const r = await runCmd("ffprobe", ["-version"], 5000);
    ffmpegAvailable = r.code === 0;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

export async function probeVideoFile(filePath: string): Promise<VideoProbeInfo> {
  const args = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ];
  const { code, stdout, stderr } = await runCmd("ffprobe", args, 60_000);
  if (code !== 0) {
    throw Object.assign(new Error(`ffprobe failed: ${stderr.slice(0, 200)}`), { status: 400 });
  }
  const json = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string; format_name?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      bit_rate?: string;
    }>;
  };
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  if (!video) {
    throw Object.assign(new Error("No video stream found"), { status: 400 });
  }
  const durationSec = Number(json.format?.duration ?? 0);
  const bitrate = Number(json.format?.bit_rate ?? video.bit_rate ?? 0) || null;
  return {
    durationSec,
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    videoCodec: String(video.codec_name ?? "unknown").toLowerCase(),
    audioCodec: audio?.codec_name ? String(audio.codec_name).toLowerCase() : null,
    bitrate,
    formatName: String(json.format?.format_name ?? "")
  };
}

/**
 * Validate probed media against product rules (MP4/H.264/AAC, duration, bitrate).
 * Soft-fail codecs when optimize will re-encode; hard-fail duration/size/extreme bitrate.
 */
export function assertVideoAllowed(
  probe: VideoProbeInfo,
  byteSize: number,
  opts?: { requireCompliantCodecs?: boolean }
): void {
  if (byteSize > POST_VIDEO_MAX_BYTES) {
    throw Object.assign(new Error(`Video exceeds ${Math.round(POST_VIDEO_MAX_BYTES / (1024 * 1024))} MB`), {
      status: 400,
      code: "VIDEO_TOO_LARGE"
    });
  }
  if (probe.durationSec < POST_VIDEO_MIN_DURATION_SEC) {
    throw Object.assign(new Error(`Video must be at least ${POST_VIDEO_MIN_DURATION_SEC} seconds`), {
      status: 400,
      code: "VIDEO_TOO_SHORT"
    });
  }
  if (probe.durationSec > POST_VIDEO_MAX_DURATION_SEC + 0.5) {
    throw Object.assign(new Error(`Video must be ≤ ${POST_VIDEO_MAX_DURATION_SEC} seconds`), {
      status: 400,
      code: "VIDEO_TOO_LONG"
    });
  }
  // Always reject extreme bitrates (bandwidth / 1GB-RAM encode risk).
  if (probe.bitrate && probe.bitrate > MAX_INPUT_BITRATE) {
    throw Object.assign(new Error("Video bitrate is too high. Compress to ≤720p before upload."), {
      status: 400,
      code: "VIDEO_BITRATE_HIGH"
    });
  }
  // Reject absurd resolutions before encode (4K+ phone dumps).
  const longEdge = Math.max(probe.width || 0, probe.height || 0);
  if (longEdge > 4096) {
    throw Object.assign(new Error("Video resolution is too high. Use ≤4K source; we output 720p."), {
      status: 400,
      code: "VIDEO_RESOLUTION_HIGH"
    });
  }
  if (opts?.requireCompliantCodecs) {
    const okVideo = probe.videoCodec === "h264" || probe.videoCodec === "avc1";
    const okAudio = !probe.audioCodec || probe.audioCodec === "aac";
    const okFmt = /mp4|mov|m4a|ismv/i.test(probe.formatName);
    if (!okVideo || !okAudio || !okFmt) {
      throw Object.assign(
        new Error("Unsupported video. Use MP4 with H.264 video and AAC audio."),
        { status: 400, code: "VIDEO_CODEC_UNSUPPORTED" }
      );
    }
  }
}

/** Target video bitrate (bps) from resolution + duration — keeps quality, caps size. */
export function chooseTargetBitrate(width: number, height: number, durationSec: number): number {
  const pixels = Math.max(1, width * height);
  const p720 = 720 * 1280;
  const scale = Math.min(1, pixels / p720);
  let bps = Math.round(2_000_000 * scale);
  if (durationSec > 45) bps = Math.round(bps * 0.85);
  if (durationSec < 10) bps = Math.round(bps * 1.1);
  return Math.max(800_000, Math.min(2_500_000, bps));
}

function scaleFilter(width: number, height: number): string {
  const long = Math.max(width, height);
  if (long <= MAX_EDGE) return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  if (width >= height) {
    return `scale=${MAX_EDGE}:-2`;
  }
  return `scale=-2:${MAX_EDGE}`;
}

/**
 * Transcode to H.264/AAC MP4 with faststart. Low-RAM: 1 thread, veryfast.
 */
export async function optimizeVideoBuffer(
  input: Buffer,
  lockKey: string
): Promise<OptimizeVideoResult> {
  if (processingLocks.has(lockKey)) {
    throw Object.assign(new Error("Video processing already in progress"), { status: 409 });
  }
  if (!(await hasFfmpeg())) {
    throw Object.assign(new Error("Video optimizer unavailable (ffmpeg not installed)"), {
      status: 503,
      code: "FFMPEG_MISSING"
    });
  }
  processingLocks.add(lockKey);
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dh-vid-"));
  const inPath = path.join(tmp, "in.bin");
  const outPath = path.join(tmp, "out.mp4");
  try {
    await fs.promises.writeFile(inPath, input);
    const probe = await probeVideoFile(inPath);
    assertVideoAllowed(probe, input.length, { requireCompliantCodecs: false });

    const outW =
      probe.width >= probe.height
        ? Math.min(MAX_EDGE, probe.width || MAX_EDGE)
        : Math.round(
            ((probe.width || 1) / (probe.height || 1)) * Math.min(MAX_EDGE, probe.height || MAX_EDGE)
          );
    const outH =
      probe.height > probe.width
        ? Math.min(MAX_EDGE, probe.height || MAX_EDGE)
        : Math.round(
            ((probe.height || 1) / (probe.width || 1)) * Math.min(MAX_EDGE, probe.width || MAX_EDGE)
          );
    const bitrate = chooseTargetBitrate(outW || MAX_EDGE, outH || MAX_EDGE, probe.durationSec);
    const vf = scaleFilter(probe.width || MAX_EDGE, probe.height || MAX_EDGE);

    const args = [
      "-y",
      "-i",
      inPath,
      "-threads",
      "1",
      "-map_metadata",
      "0",
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      String(bitrate),
      "-maxrate",
      String(Math.round(bitrate * 1.3)),
      "-bufsize",
      String(Math.round(bitrate * 2)),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outPath
    ];
    const { code, stderr } = await runCmd("ffmpeg", args, 180_000);
    if (code !== 0) {
      throw Object.assign(new Error(`ffmpeg failed: ${stderr.slice(-300)}`), { status: 500 });
    }
    const buffer = await fs.promises.readFile(outPath);
    if (buffer.length > POST_VIDEO_MAX_BYTES) {
      throw Object.assign(new Error("Optimized video still exceeds size limit"), { status: 400 });
    }
    const outProbe = await probeVideoFile(outPath);
    return {
      buffer,
      width: outProbe.width,
      height: outProbe.height,
      durationSec: outProbe.durationSec || probe.durationSec,
      byteSize: buffer.length,
      videoCodec: "h264",
      audioCodec: "aac"
    };
  } finally {
    processingLocks.delete(lockKey);
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Extract a JPEG frame at timestamp (seconds) for poster → Sharp WebP variants. */
export async function extractVideoFrameJpeg(
  input: Buffer,
  atSec: number,
  lockKey: string
): Promise<Buffer> {
  if (!(await hasFfmpeg())) {
    throw Object.assign(new Error("ffmpeg not available for thumbnails"), { status: 503 });
  }
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dh-thumb-"));
  const inPath = path.join(tmp, "in.bin");
  const outPath = path.join(tmp, "frame.jpg");
  try {
    await fs.promises.writeFile(inPath, input);
    const ss = Math.max(0, atSec);
    const args = [
      "-y",
      "-ss",
      String(ss),
      "-i",
      inPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      outPath
    ];
    const { code, stderr } = await runCmd("ffmpeg", args, 60_000);
    if (code !== 0) {
      throw Object.assign(new Error(`thumbnail extract failed: ${stderr.slice(-200)}`), {
        status: 500
      });
    }
    return await fs.promises.readFile(outPath);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
