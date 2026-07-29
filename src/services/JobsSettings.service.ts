/**
 * Jobs business rules via Business Settings (DB → constant fallback).
 * Reuses Jobs module; does not duplicate AdminJobs / JobInterest APIs.
 */

import * as BusinessSettings from "./BusinessSettings.service";
import {
  JOB_APPLICATION_LIMIT_PER_JOB,
  JOB_DEFAULT_EXPIRY_DAYS,
  JOB_EMPLOYMENT_TYPE_OPTIONS,
  JOB_FEATURED_PRICE_INR,
  JOB_MAX_ACTIVE_OPEN,
  jobExpiryDate
} from "../constants/jobs.constants";
import { JOB_EMPLOYMENT_TYPES } from "../models/Post.model";

async function numberOrFallback(key: string, fallback: number): Promise<number> {
  try {
    const n = await BusinessSettings.getNumberSetting("jobs", key);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

async function warm(): Promise<void> {
  await BusinessSettings.ensureModuleWarmed("jobs");
}

export async function getMaxActiveJobs(): Promise<number> {
  await warm();
  return numberOrFallback("max_active_jobs", JOB_MAX_ACTIVE_OPEN);
}

export async function getApplicationLimit(): Promise<number> {
  await warm();
  return numberOrFallback("application_limit_per_job", JOB_APPLICATION_LIMIT_PER_JOB);
}

export async function getJobExpiryDays(): Promise<number> {
  await warm();
  return numberOrFallback("job_expiry_days", JOB_DEFAULT_EXPIRY_DAYS);
}

export async function getFeaturedJobPriceInr(): Promise<number> {
  await warm();
  return numberOrFallback("featured_job_price_inr", JOB_FEATURED_PRICE_INR);
}

/** Employment types allowed by config, intersected with DB ENUM. */
export async function getEmploymentTypes(): Promise<string[]> {
  await warm();
  const allowedDb = new Set<string>(JOB_EMPLOYMENT_TYPES);
  try {
    const raw = await BusinessSettings.getJsonSetting<unknown>("jobs", "employment_types");
    if (!Array.isArray(raw)) return JOB_EMPLOYMENT_TYPE_OPTIONS.filter((t) => allowedDb.has(t));
    const fromSettings = raw
      .map((v) => String(v || "").trim().toUpperCase())
      .filter((v) => allowedDb.has(v));
    return fromSettings.length > 0 ? fromSettings : JOB_EMPLOYMENT_TYPE_OPTIONS.filter((t) => allowedDb.has(t));
  } catch {
    return JOB_EMPLOYMENT_TYPE_OPTIONS.filter((t) => allowedDb.has(t));
  }
}

export async function assertEmploymentTypeAllowed(type: string | null | undefined): Promise<void> {
  if (type == null || type === "") return;
  const allowed = await getEmploymentTypes();
  if (!allowed.includes(type)) {
    throw Object.assign(
      new Error(`Employment type "${type}" is not enabled. Allowed: ${allowed.join(", ")}`),
      { status: 400, code: "JOB_EMPLOYMENT_TYPE_DISABLED" }
    );
  }
}

/** Default deadline from settings, or null when expiry days is 0 (unlimited / no auto). */
export async function resolveDefaultJobDeadline(from: Date = new Date()): Promise<Date | null> {
  const days = await getJobExpiryDays();
  if (!days || days <= 0) return null;
  return jobExpiryDate(days, from);
}

export async function getJobsConfigSnapshot(): Promise<{
  maxActiveJobs: number;
  applicationLimitPerJob: number;
  jobExpiryDays: number;
  featuredJobPriceInr: number;
  employmentTypes: string[];
}> {
  await warm();
  const map = await BusinessSettings.getSettingsByModule("jobs");
  const num = (key: string, fallback: number) => {
    const n = Number(map[key]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const allowedDb = new Set<string>(JOB_EMPLOYMENT_TYPES);
  let employmentTypes = JOB_EMPLOYMENT_TYPE_OPTIONS.filter((t) => allowedDb.has(t));
  if (Array.isArray(map.employment_types)) {
    const fromSettings = (map.employment_types as unknown[])
      .map((v) => String(v || "").trim().toUpperCase())
      .filter((v) => allowedDb.has(v));
    if (fromSettings.length > 0) employmentTypes = fromSettings;
  }
  return {
    maxActiveJobs: num("max_active_jobs", JOB_MAX_ACTIVE_OPEN),
    applicationLimitPerJob: num("application_limit_per_job", JOB_APPLICATION_LIMIT_PER_JOB),
    jobExpiryDays: num("job_expiry_days", JOB_DEFAULT_EXPIRY_DAYS),
    featuredJobPriceInr: num("featured_job_price_inr", JOB_FEATURED_PRICE_INR),
    employmentTypes
  };
}
