/** Expo client tokens from expo-notifications */
export function isExpoPushToken(token: string): boolean {
  const t = token.trim();
  return t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");
}

/** Native FCM registration token (future direct FCM builds) */
export function isFcmPushToken(token: string): boolean {
  return !isExpoPushToken(token) && token.length >= 32;
}
