/**
 * Home-feed post types vs dedicated-module types.
 * Module posts keep existing DB enum values for backward compatibility,
 * but must be created through their own screens (with creation_source).
 */

import { POST_TYPES, type PostType } from "../models/Post.model";

/** Selectable from Home Feed / general Create Post dropdown. */
export const FEED_POST_TYPES = [
  "ANNOUNCEMENT",
  "MEETUP",
  "ACHIEVEMENT",
  "ENTERTAINMENT"
] as const satisfies readonly PostType[];

export type FeedPostType = (typeof FEED_POST_TYPES)[number];

/** Created only from Jobs / Marketplace / Helping Hands modules. */
export const MODULE_POST_TYPES = ["JOB", "MARKETPLACE", "HELP_REQUEST"] as const satisfies readonly PostType[];

export type ModulePostType = (typeof MODULE_POST_TYPES)[number];

/** Legacy / unused via Create Post — Matrimony uses its own product flow. */
export const BLOCKED_FEED_POST_TYPES = ["MATRIMONY"] as const satisfies readonly PostType[];

export type CreationSource = "feed" | "jobs" | "marketplace" | "helping_hands";

const FEED_SET = new Set<string>(FEED_POST_TYPES);
const MODULE_SET = new Set<string>(MODULE_POST_TYPES);

export function isFeedPostType(postType: string): boolean {
  return FEED_SET.has(postType);
}

export function isModulePostType(postType: string): boolean {
  return MODULE_SET.has(postType);
}

export function expectedCreationSource(postType: string): CreationSource | null {
  switch (postType) {
    case "JOB":
      return "jobs";
    case "MARKETPLACE":
      return "marketplace";
    case "HELP_REQUEST":
      return "helping_hands";
    default:
      if (isFeedPostType(postType)) return "feed";
      return null;
  }
}

/** All known post types (DB enum) — re-exported for convenience. */
export { POST_TYPES };
