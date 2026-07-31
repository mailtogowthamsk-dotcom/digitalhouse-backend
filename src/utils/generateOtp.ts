import { randomInt } from "crypto";

/** Generate a cryptographically secure 6-digit numeric OTP (100000–999999). */
export function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}
