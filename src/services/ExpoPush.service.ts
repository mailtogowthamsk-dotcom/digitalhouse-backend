/**
 * Expo Push Notification API (FCM/APNs via Expo).
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

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

type ExpoPushResponse = { data?: ExpoTicket[] };

export async function sendExpoPush(
  messages: ExpoPushMessage[]
): Promise<{ invalidTokens: string[]; sent: number }> {
  if (!messages.length) return { invalidTokens: [], sent: 0 };

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const invalidTokens: string[] = [];
  let sent = 0;

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
        if (ticket.status === "ok") {
          sent += 1;
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(chunk[j].to);
        } else if (process.env.NODE_ENV === "development") {
          console.warn("[ExpoPush] ticket error", ticket);
        }
      }
    } catch (err) {
      console.error("[ExpoPush] request failed", err);
    }
  }

  return { invalidTokens, sent };
}
