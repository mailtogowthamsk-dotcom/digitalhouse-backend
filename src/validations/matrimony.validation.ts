import { z } from "zod";
import { validateSectionPayload } from "./profile.validation";

const idArraySchema = z.array(z.number().int().positive()).min(1);

export const matrimonyDraftBodySchema = z
  .object({
    matrimony: z.record(z.unknown())
  })
  .strict();

export function validateMatrimonyDraftBody(body: unknown): Record<string, unknown> {
  const parsed = matrimonyDraftBodySchema.parse(body);
  return validateSectionPayload("matrimony", parsed.matrimony);
}

export const matrimonySubmitBodySchema = z
  .object({
    matrimony: z.record(z.unknown()).optional()
  })
  .strict();

export function validateMatrimonySubmitBody(body: unknown): Record<string, unknown> | undefined {
  const parsed = matrimonySubmitBodySchema.parse(body ?? {});
  if (!parsed.matrimony) return undefined;
  return validateSectionPayload("matrimony", parsed.matrimony);
}

export function validatePreferredIds(ids: unknown, field: string): number[] {
  const arr = idArraySchema.parse(ids);
  return arr;
}
