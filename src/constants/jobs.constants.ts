/**
 * Jobs business defaults — used as Business Settings fallbacks.
 * Numeric 0 means unlimited / no auto-behaviour (preserves current Jobs UX).
 */

import { JOB_EMPLOYMENT_TYPES } from "../models/Post.model";

/** Max concurrently OPEN jobs per poster. 0 = unlimited. */
export const JOB_MAX_ACTIVE_OPEN = 0;

/** Max applications (interests) per job posting. 0 = unlimited. */
export const JOB_APPLICATION_LIMIT_PER_JOB = 0;

/**
 * Default job application deadline length in days when none is provided on create.
 * 0 = leave deadline null (current behaviour).
 */
export const JOB_DEFAULT_EXPIRY_DAYS = 0;

/** Featured job price in INR (config only until billing is wired). */
export const JOB_FEATURED_PRICE_INR = 0;

/** Configurable employment-type options (must stay within DB ENUM values). */
export const JOB_EMPLOYMENT_TYPE_OPTIONS: string[] = [...JOB_EMPLOYMENT_TYPES];

export function jobExpiryDate(days: number, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + Math.max(0, Math.floor(days)));
  return d;
}
