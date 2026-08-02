import { z } from "zod";
import { validateSectionPayload } from "./profile.validation";

const idArraySchema = z.array(z.number().int().positive()).min(1);

/** Server-owned matrimony JSON keys — never accept from client draft/submit bodies. */
const MATRIMONY_SERVER_MANAGED_KEYS = new Set([
  "matrimonyLifecycle",
  "matrimonySuspended",
  "pausedAt",
  "closedAt",
  "withdrawnAt",
  "closeReason",
  "_submittedForReview",
  "_submissionSnapshot",
  "_resubmissionCount"
]);

function omitServerManagedMatrimonyKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (MATRIMONY_SERVER_MANAGED_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export const matrimonyDraftBodySchema = z
  .object({
    matrimony: z.record(z.unknown())
  })
  .strict();

export function validateMatrimonyDraftBody(body: unknown): Record<string, unknown> {
  const parsed = matrimonyDraftBodySchema.parse(body);
  return validateSectionPayload("matrimony", omitServerManagedMatrimonyKeys(parsed.matrimony));
}

export const matrimonySubmitBodySchema = z
  .object({
    matrimony: z.record(z.unknown()).optional()
  })
  .strict();

export function validateMatrimonySubmitBody(body: unknown): Record<string, unknown> | undefined {
  const parsed = matrimonySubmitBodySchema.parse(body ?? {});
  if (!parsed.matrimony) return undefined;
  return validateSectionPayload("matrimony", omitServerManagedMatrimonyKeys(parsed.matrimony));
}

export function validatePreferredIds(ids: unknown, field: string): number[] {
  const arr = idArraySchema.parse(ids);
  return arr;
}
