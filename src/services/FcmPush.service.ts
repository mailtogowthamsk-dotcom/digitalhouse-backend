/**
 * Direct FCM HTTP v1 (optional). Enable with FIREBASE_SERVICE_ACCOUNT_JSON (full JSON string).
 * Expo tokens are handled by ExpoPush.service.ts.
 */

import { readFileSync } from "fs";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      return null;
    }
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
  } catch {
    return null;
  }
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const iat = Math.floor(now / 1000);
  const claim = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging"
  };
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const unsigned = `${header}.${payload}`;

  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000
  };
  return json.access_token;
}

export type FcmPushPayload = {
  title: string;
  body?: string;
  data?: Record<string, string>;
  priority?: "high" | "normal";
};

export async function sendFcmPush(
  tokens: string[],
  payload: FcmPushPayload
): Promise<{ sent: number; invalidTokens: string[] }> {
  const sa = loadServiceAccount();
  if (!sa || !tokens.length) return { sent: 0, invalidTokens: [] };

  const accessToken = await getAccessToken(sa);
  if (!accessToken) {
    console.warn("[FcmPush] Could not obtain access token");
    return { sent: 0, invalidTokens: [] };
  }

  const invalidTokens: string[] = [];
  let sent = 0;

  for (const token of tokens) {
    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: payload.title, body: payload.body },
              data: payload.data,
              android: {
                priority: payload.priority === "high" ? "HIGH" : "NORMAL"
              }
            }
          })
        }
      );
      if (res.ok) {
        sent += 1;
      } else {
        const text = await res.text();
        if (text.includes("UNREGISTERED") || text.includes("NOT_FOUND")) {
          invalidTokens.push(token);
        } else if (process.env.NODE_ENV === "development") {
          console.warn("[FcmPush]", res.status, text.slice(0, 200));
        }
      }
    } catch (err) {
      console.error("[FcmPush]", err);
    }
  }

  return { sent, invalidTokens };
}

export function isFcmConfigured(): boolean {
  return !!loadServiceAccount();
}
