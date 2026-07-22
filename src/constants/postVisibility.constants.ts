/** Post audience visibility — PUBLIC (Community) | CONNECTIONS (Connections Only). */
export const POST_VISIBILITIES = ["PUBLIC", "CONNECTIONS"] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const DEFAULT_POST_VISIBILITY: PostVisibility = "PUBLIC";

export function parsePostVisibility(value: unknown): PostVisibility {
  if (value === "CONNECTIONS" || value === "PUBLIC") return value;
  return DEFAULT_POST_VISIBILITY;
}

export function postVisibilityLabel(visibility: PostVisibility | string | null | undefined): string {
  return visibility === "CONNECTIONS" ? "Connections" : "Community";
}
