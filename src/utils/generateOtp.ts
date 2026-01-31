/** Generate a 6-digit numeric OTP */
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
