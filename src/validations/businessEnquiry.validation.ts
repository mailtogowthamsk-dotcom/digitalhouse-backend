import { z } from "zod";
import { BUSINESS_ENQUIRY_TYPES } from "../services/BusinessEnquiry.service";

export const submitBusinessEnquirySchema = z.object({
  businessOwnerId: z.coerce.number().int().positive(),
  enquiryType: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => (BUSINESS_ENQUIRY_TYPES as readonly string[]).includes(v), {
      message: "Please select what you are looking for."
    }),
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters.")
    .max(2000, "Message must be at most 2000 characters."),
  clientId: z.string().trim().min(8).max(64).optional().nullable()
});

export type SubmitBusinessEnquiryInput = z.infer<typeof submitBusinessEnquirySchema>;
