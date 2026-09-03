import { z } from "zod";

export const websiteContactSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().email("Valid email is required").toLowerCase().max(191),
  subject: z.string().trim().min(2, "Subject is required").max(160),
  message: z.string().trim().min(10, "Message is too short").max(5000),
  /** Honeypot — bots that fill this are silently accepted without sending mail. */
  company: z.string().max(200).optional()
});

export type WebsiteContactInput = z.infer<typeof websiteContactSchema>;
