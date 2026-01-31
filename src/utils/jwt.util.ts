import jwt from "jsonwebtoken";

const secret = process.env.JWT_ACCESS_SECRET || "change_me_access";

export function signAccessToken(payload: { userId: number }) {
  return jwt.sign(payload, secret as jwt.Secret, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "7d") as string
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): { userId: number } {
  return jwt.verify(token, secret as jwt.Secret) as { userId: number };
}

