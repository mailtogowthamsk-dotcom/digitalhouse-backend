import type { User } from "../models/user.model";
import {
  AUTH_PROVIDERS,
  type AuthProviderCode,
  type LoginSourceLabel
} from "../constants/auth.constants";

export function parseLinkedProviders(raw: unknown): AuthProviderCode[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is AuthProviderCode => p === AUTH_PROVIDERS.EXISTING_LOGIN || p === AUTH_PROVIDERS.GOOGLE
  );
}

export function ensureLinkedProviders(user: User): AuthProviderCode[] {
  const parsed = parseLinkedProviders(user.linkedProviders);
  if (parsed.length > 0) return parsed;
  if (user.googleId && user.signupProvider === AUTH_PROVIDERS.GOOGLE) {
    return [AUTH_PROVIDERS.GOOGLE];
  }
  return [AUTH_PROVIDERS.EXISTING_LOGIN];
}

export function mergeLinkedProvider(
  current: AuthProviderCode[] | null | undefined,
  provider: AuthProviderCode
): AuthProviderCode[] {
  const set = new Set(parseLinkedProviders(current));
  set.add(provider);
  return Array.from(set);
}

export function resolveLoginSource(user: User): LoginSourceLabel {
  const linked = ensureLinkedProviders(user);
  const hasGoogle = linked.includes(AUTH_PROVIDERS.GOOGLE) || !!user.googleId;
  const hasExisting = linked.includes(AUTH_PROVIDERS.EXISTING_LOGIN);
  if (hasGoogle && hasExisting) return "Both";
  if (hasGoogle) return "Google";
  return "Existing Login";
}
