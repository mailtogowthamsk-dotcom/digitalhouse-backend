import { generateOtp } from "./generateOtp";

/** @deprecated Prefer generateOtp() — kept for any legacy imports. */
export function generateOtp6(): string {
  return generateOtp();
}
