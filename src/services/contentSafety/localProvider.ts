import fs from "fs";
import path from "path";
import {
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_VERSION,
  type SafetyCategory
} from "../../constants/contentSafety.constants";
import { decodeImageForModeration } from "./imageInput";
import { safetyThresholds } from "./policyEngine";
import type { NormalizedModerationResult } from "./types";

type NsfwPrediction = { className: string; probability: number };

let modelPromise: Promise<{ classify: (tensor: unknown) => Promise<NsfwPrediction[]> }> | null = null;
let tfModule: { tensor3d: Function; dispose?: Function } | null = null;

function modelDir(): string {
  return process.env.MODERATION_MODEL_DIR || path.join(process.cwd(), "models", "nsfwjs");
}

function maxImageBytes(): number {
  const n = Number(process.env.MODERATION_MAX_IMAGE_SIZE || 2_000_000);
  return Number.isFinite(n) ? Math.max(32_000, n) : 2_000_000;
}

function timeoutMs(): number {
  const n = Number(process.env.MODERATION_TIMEOUT_MS || 30_000);
  return Number.isFinite(n) ? Math.max(3_000, n) : 30_000;
}

async function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const dir = modelDir();
    const modelJson = path.join(dir, "model.json");
    if (!fs.existsSync(modelJson)) {
      throw new Error(`NSFWJS model.json missing at ${dir}`);
    }
    // Optional: nsfwjs + @tensorflow/tfjs (pure JS). Fail closed if not installed.
    const tf = await import("@tensorflow/tfjs");
    await import("@tensorflow/tfjs-backend-cpu").catch(() => undefined);
    if (typeof (tf as any).setBackend === "function") {
      await (tf as any).setBackend("cpu");
    }
    await (tf as any).ready?.();
    tfModule = tf as any;
    const nsfwjs = await import("nsfwjs");
    const fileUrl = `file://${dir.replace(/\\/g, "/")}/`;
    const model = await (nsfwjs as any).load(fileUrl, { size: 224, type: "graph" });
    return model;
  })();
  try {
    return await modelPromise;
  } catch (err) {
    modelPromise = null;
    throw err;
  }
}

function mapPredictions(predictions: NsfwPrediction[]): {
  category: SafetyCategory;
  confidence: number;
  scores: Record<string, number>;
} {
  const scores: Record<string, number> = {};
  for (const p of predictions) {
    scores[p.className.toLowerCase()] = p.probability;
  }
  const porn = scores.porn ?? 0;
  const hentai = scores.hentai ?? 0;
  const sexy = scores.sexy ?? 0;
  const sexual = porn + hentai;
  const thresholds = safetyThresholds();

  if (sexual >= thresholds.blockSexual) {
    return {
      category: porn >= hentai ? "SEXUAL_EXPLICIT" : "SEXUAL_EXPLICIT",
      confidence: Math.min(1, sexual),
      scores
    };
  }
  if (sexy >= thresholds.blockSexy) {
    return { category: "SEXUALIZED_CONTENT", confidence: sexy, scores };
  }
  if (sexual >= thresholds.reviewSexual || sexy >= thresholds.reviewSexy) {
    return {
      category: sexy >= sexual ? "SEXUALIZED_CONTENT" : "SEXUAL_EXPLICIT",
      confidence: Math.max(sexual, sexy),
      scores
    };
  }
  const neutral = (scores.neutral ?? 0) + (scores.drawing ?? 0);
  return { category: "SAFE", confidence: Math.min(1, Math.max(neutral, 1 - sexual - sexy)), scores };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("MODEL_TIMEOUT"), { code: "MODEL_TIMEOUT" })), ms);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isLocalModelAvailable(): boolean {
  try {
    return fs.existsSync(path.join(modelDir(), "model.json"));
  } catch {
    return false;
  }
}

export async function classifyImageBuffer(buffer: Buffer): Promise<NormalizedModerationResult> {
  const base = {
    modelName: LOCAL_MODEL_NAME,
    modelVersion: LOCAL_MODEL_VERSION,
    available: false,
    category: "UNCERTAIN" as SafetyCategory,
    confidence: null as number | null,
    failed: false,
    timeout: false,
    corrupt: false,
    unsupported: false,
    insufficientCoverage: false
  };

  if (!isLocalModelAvailable()) {
    return {
      ...base,
      failed: true,
      failureReason: "MODEL_UNAVAILABLE"
    };
  }

  try {
    const decoded = await decodeImageForModeration(buffer, maxImageBytes());
    const model = await withTimeout(loadModel(), timeoutMs());
    const tf = tfModule;
    if (!tf) {
      return { ...base, failed: true, failureReason: "MODEL_UNAVAILABLE" };
    }
    const tensor = tf.tensor3d(new Uint8Array(decoded.rgb), [decoded.height, decoded.width, 3]);
    try {
      const predictions = (await withTimeout(model.classify(tensor), timeoutMs())) as NsfwPrediction[];
      if (!predictions?.length) {
        return { ...base, failed: true, failureReason: "MISSING_RESULT" };
      }
      const mapped = mapPredictions(predictions);
      return {
        ...base,
        available: true,
        category: mapped.category,
        confidence: mapped.confidence,
        rawScores: mapped.scores
      };
    } finally {
      tensor.dispose?.();
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "MODEL_TIMEOUT") {
      return { ...base, timeout: true, failed: true, failureReason: "MODEL_TIMEOUT" };
    }
    if (code === "CORRUPT_IMAGE") {
      return { ...base, corrupt: true, failed: true, failureReason: "CORRUPTED_MEDIA" };
    }
    if (code === "UNSUPPORTED_IMAGE" || code === "IMAGE_TOO_LARGE") {
      return { ...base, unsupported: true, failed: true, failureReason: String(code) };
    }
    return {
      ...base,
      failed: true,
      failureReason: err instanceof Error ? err.message.slice(0, 300) : "MODEL_FAILURE"
    };
  }
}
