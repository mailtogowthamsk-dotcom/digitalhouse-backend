import jwt from "jsonwebtoken";

const rawSecret = process.env.JWT_ACCESS_SECRET?.trim();
const DEFAULT_DEV_SECRET = "change_me_access";

if (
  process.env.NODE_ENV === "production" &&
  (!rawSecret || rawSecret === DEFAULT_DEV_SECRET)
) {
  throw new Error(
    "JWT_ACCESS_SECRET must be set to a strong secret in production (not the default)."
  );
}

const secret = rawSecret || DEFAULT_DEV_SECRET;

export function signAccessToken(payload: { userId: number }) {
  return jwt.sign(payload, secret as jwt.Secret, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "7d") as string
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): { userId: number } {
  return jwt.verify(token, secret as jwt.Secret) as { userId: number };
}

/** Admin JWT (same secret, payload.admin = true). Used after admin login. */
export function signAdminToken(payload: { email: string; role?: string }) {
  return jwt.sign(
    { ...payload, admin: true },
    secret as jwt.Secret,
    { expiresIn: (process.env.JWT_ADMIN_EXPIRES_IN || "24h") as string } as jwt.SignOptions
  );
}

export function verifyAdminToken(token: string): { email: string; admin: true; role?: string } {
  const decoded = jwt.verify(token, secret as jwt.Secret) as {
    email?: string;
    admin?: boolean;
    role?: string;
  };
  if (!decoded.admin || !decoded.email) throw new Error("Invalid admin token");
  return { email: decoded.email, admin: true, role: decoded.role };
}

