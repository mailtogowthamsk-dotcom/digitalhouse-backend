import { z } from "zod";

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional()
  );

export const discoverQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    district: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().max(120).trim().optional()
    ),
    ageMin: optionalInt(18, 80),
    ageMax: optionalInt(18, 80),
    horoscopeOnly: z.preprocess((v) => {
      if (v === true || v === "true" || v === "1") return true;
      if (v === false || v === "false" || v === "0") return false;
      return undefined;
    }, z.boolean().optional())
  })
  .refine(
    (q) => {
      if (q.ageMin != null && q.ageMax != null && q.ageMin > q.ageMax) return false;
      return true;
    },
    { message: "ageMin cannot be greater than ageMax" }
  );

export const sendInterestSchema = z.object({
  toUserId: z.coerce.number().int().positive(),
  introMessage: z.string().max(500).optional().nullable()
});

export const respondInterestSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"]),
  introMessage: z.string().max(500).optional().nullable()
});
