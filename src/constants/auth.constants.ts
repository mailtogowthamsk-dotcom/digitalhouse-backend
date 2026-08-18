export const AUTH_PROVIDERS = {
  EXISTING_LOGIN: "EXISTING_LOGIN",
  GOOGLE: "GOOGLE"
} as const;

export type AuthProviderCode = (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];

export type LoginSourceLabel = "Google" | "Existing Login" | "Both";

export const AUTH_ANALYTICS_EVENTS = {
  GOOGLE_SIGNUP: "GOOGLE_SIGNUP",
  GOOGLE_LOGIN: "GOOGLE_LOGIN",
  EXISTING_LOGIN: "EXISTING_LOGIN",
  GOOGLE_LINKED: "GOOGLE_LINKED",
  GOOGLE_MATRIMONY_APPLY: "GOOGLE_MATRIMONY_APPLY"
} as const;

export type AuthAnalyticsEventType =
  (typeof AUTH_ANALYTICS_EVENTS)[keyof typeof AUTH_ANALYTICS_EVENTS];

/** This app is for one community. Registration never accepts a client community name. */
export const DEFAULT_APP_COMMUNITY = "Vettuva Gounder";
