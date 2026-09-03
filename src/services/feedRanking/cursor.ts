import crypto from "crypto";
import { FEED_RANKING_VERSION } from "./config";
import type { DecodedFeedCursor, FeedSessionContext } from "./types";

function cursorSecret(): string {
  return (
    process.env.FEED_CURSOR_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    "change_me_access"
  );
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", cursorSecret()).update(payload).digest();
  return b64url(mac.subarray(0, 16));
}

export function newSessionId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function sessionSeed(sessionId: string, rankingVersion: number): number {
  const h = crypto.createHash("sha256").update(`${sessionId}:${rankingVersion}`).digest();
  return h.readUInt32BE(0);
}

export function makeSessionContext(sessionId?: string): FeedSessionContext {
  const id = sessionId && /^[a-f0-9]{16}$/i.test(sessionId) ? sessionId : newSessionId();
  return {
    rankingVersion: FEED_RANKING_VERSION,
    sessionId: id,
    seed: sessionSeed(id, FEED_RANKING_VERSION)
  };
}

export function encodeFeedCursor(params: {
  session: FeedSessionContext;
  score: number;
  createdAt: Date;
  postId: number;
  phase?: "ranked" | "tail";
}): string {
  const body = JSON.stringify({
    v: params.session.rankingVersion,
    s: params.session.sessionId,
    p: params.phase === "tail" ? "t" : "r",
    sc: Math.round(params.score * 10000) / 10000,
    t: params.createdAt.getTime(),
    id: params.postId
  });
  const payload = b64url(body);
  return `${payload}.${sign(payload)}`;
}

export function encodeTailStartCursor(session: FeedSessionContext): string {
  return encodeFeedCursor({
    session,
    score: 0,
    createdAt: new Date(0),
    postId: 0,
    phase: "tail"
  });
}

export function decodeFeedCursor(raw: string | null | undefined): DecodedFeedCursor | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.includes(".")) return null;
  const dot = trimmed.lastIndexOf(".");
  const payload = trimmed.slice(0, dot);
  const mac = trimmed.slice(dot + 1);
  if (!payload || !mac) return null;
  if (sign(payload) !== mac) return null;
  try {
    const json = JSON.parse(fromB64url(payload).toString("utf8")) as {
      v?: number;
      s?: string;
      p?: string;
      sc?: number;
      t?: number;
      id?: number;
    };
    if (json.v !== FEED_RANKING_VERSION) return null;
    if (typeof json.s !== "string" || typeof json.sc !== "number" || typeof json.t !== "number" || typeof json.id !== "number") {
      return null;
    }
    if (!Number.isFinite(json.sc) || !Number.isFinite(json.t) || !Number.isInteger(json.id) || json.id < 0) {
      return null;
    }
    return {
      rankingVersion: json.v,
      sessionId: json.s,
      seed: sessionSeed(json.s, json.v),
      score: json.sc,
      tieBreaker: json.t,
      postId: json.id,
      phase: json.p === "t" ? "tail" : "ranked"
    };
  } catch {
    return null;
  }
}

export function isOpaqueFeedCursor(raw: string | number | null | undefined): boolean {
  return typeof raw === "string" && raw.includes(".") && !/^\d+$/.test(raw.trim());
}
