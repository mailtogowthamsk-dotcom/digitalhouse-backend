/**
 * Expo Push Notification API (FCM/APNs via Expo).
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 * @see https://docs.expo.dev/push-notifications/receiving-notifications/
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK_SIZE = 100;
/** Expo recommends waiting briefly before fetching receipts */
const RECEIPT_DELAY_MS = 1_200;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, string>;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
  channelId?: string;
  badge?: number;
};

type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

type ExpoReceipt =
  | { status: "ok"; details?: unknown }
  | {
      status: "error";
      message?: string;
      details?: { error?: string; expoPushToken?: string };
    };

type ExpoPushResponse = { data?: ExpoTicket[] };
type ExpoReceiptsResponse = { data?: Record<string, ExpoReceipt> };

function authHeaders(): Record<string, string> {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Look up Expo delivery receipts. Maps DeviceNotRegistered (and similar) back to tokens.
 */
async function collectInvalidTokensFromReceipts(
  ticketIdToToken: Map<string, string>
): Promise<string[]> {
  const ids = [...ticketIdToToken.keys()];
  if (!ids.length) return [];

  const invalid: string[] = [];
  const headers = authHeaders();

  try {
    await sleep(RECEIPT_DELAY_MS);
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: chunk })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[ExpoPush] receipts HTTP", res.status, text.slice(0, 500));
        continue;
      }
      const json = (await res.json()) as ExpoReceiptsResponse;
      const data = json.data ?? {};
      for (const id of chunk) {
        const receipt = data[id];
        if (!receipt) continue;
        if (receipt.status === "ok") continue;
        const err = receipt.details?.error;
        console.warn("[ExpoPush] receipt error", {
          ticketId: id,
          error: err,
          message: receipt.message
        });
        // Only DeviceNotRegistered means this device token is dead.
        // InvalidCredentials / MismatchSenderId are usually project FCM config — do not wipe tokens.
        if (err === "DeviceNotRegistered") {
          const token =
            receipt.details?.expoPushToken ?? ticketIdToToken.get(id) ?? null;
          if (token) invalid.push(token);
        }
      }
    }
  } catch (err) {
    console.error("[ExpoPush] receipts request failed", err);
  }

  return invalid;
}

export async function sendExpoPush(
  messages: ExpoPushMessage[]
): Promise<{ invalidTokens: string[]; sent: number }> {
  if (!messages.length) return { invalidTokens: [], sent: 0 };

  const headers = authHeaders();
  const invalidTokens: string[] = [];
  let sent = 0;
  const ticketIdToToken = new Map<string, string>();

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(chunk)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[ExpoPush] HTTP", res.status, text.slice(0, 500));
        continue;
      }

      const json = (await res.json()) as ExpoPushResponse;
      const tickets = json.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        const token = chunk[j]?.to;
        if (ticket.status === "ok") {
          sent += 1;
          if (ticket.id && token) ticketIdToToken.set(ticket.id, token);
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          if (token) invalidTokens.push(token);
          console.warn("[ExpoPush] ticket DeviceNotRegistered");
        } else {
          console.warn("[ExpoPush] ticket error", {
            error: ticket.details?.error,
            message: ticket.message
          });
        }
      }
    } catch (err) {
      console.error("[ExpoPush] request failed", err);
    }
  }

  const fromReceipts = await collectInvalidTokensFromReceipts(ticketIdToToken);
  for (const t of fromReceipts) {
    if (!invalidTokens.includes(t)) invalidTokens.push(t);
  }

  console.info(
    `[ExpoPush] sent=${sent} tickets=${ticketIdToToken.size} invalid=${invalidTokens.length}`
  );

  return { invalidTokens, sent };
}
