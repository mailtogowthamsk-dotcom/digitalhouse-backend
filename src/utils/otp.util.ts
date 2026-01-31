export function generateOtp6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

