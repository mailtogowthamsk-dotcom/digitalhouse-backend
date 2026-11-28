import { randomBytes } from "node:crypto";
import { QueryTypes, type Transaction } from "sequelize";
import { sequelize } from "../config/db";
import { generateOtp } from "../utils/generateOtp";
import { timingSafeEqualHex } from "../utils/timingSafe.util";
import { hashEmailOtp, sha256Hex } from "../utils/hash.util";
import { sendRegistrationOtpEmail } from "./mail.service";

const CODE_MINUTES = 10;
const RESEND_SECONDS = 60;
const PROOF_MINUTES = 60;
const MAX_ATTEMPTS = 5;

type Challenge = {
  codeHash: string | null;
  codeSecondsLeft: number | string | null;
  resendSecondsLeft: number | string | null;
  attempts: number;
};

function otpHash(email: string, code: string) {
  return hashEmailOtp(`registration:${email}`, code);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getChallenge(email: string, transaction: Transaction) {
  const [row] = await sequelize.query<Challenge>(
    `SELECT code_hash AS codeHash,
            TIMESTAMPDIFF(MICROSECOND, NOW(3), code_expires_at) / 1000000 AS codeSecondsLeft,
            TIMESTAMPDIFF(MICROSECOND, NOW(3), next_send_at) / 1000000 AS resendSecondsLeft,
            attempts
     FROM registration_email_verifications WHERE email = :email FOR UPDATE`,
    { type: QueryTypes.SELECT, replacements: { email }, transaction }
  );
  return row;
}

export async function sendRegistrationCode(address: string) {
  const email = normalizeEmail(address);
  const code = generateOtp();
  const hash = otpHash(email, code);
  const retryAfterSeconds = await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `INSERT INTO registration_email_verifications (email) VALUES (:email)
       ON DUPLICATE KEY UPDATE email = email`,
      { replacements: { email }, transaction }
    );
    const row = await getChallenge(email, transaction);
    const wait = Math.ceil(Number(row.resendSecondsLeft));
    if (wait > 0) return wait;
    await sequelize.query(
      `UPDATE registration_email_verifications
       SET code_hash = :hash, code_expires_at = DATE_ADD(NOW(3), INTERVAL :codeMinutes MINUTE),
           next_send_at = DATE_ADD(NOW(3), INTERVAL :resendSeconds SECOND), attempts = 0
       WHERE email = :email`,
      { replacements: { email, hash, codeMinutes: CODE_MINUTES, resendSeconds: RESEND_SECONDS }, transaction }
    );
    return 0;
  });
  if (retryAfterSeconds) return { sent: false as const, retryAfterSeconds };

  try {
    await sendRegistrationOtpEmail(email, code, CODE_MINUTES);
  } catch {
    // Only release the challenge owned by this send attempt.
    await sequelize.query(
      `UPDATE registration_email_verifications
       SET code_hash = NULL, code_expires_at = NULL, next_send_at = NULL
       WHERE email = :email AND code_hash = :hash`,
      { replacements: { email, hash } }
    );
    throw Object.assign(new Error("Could not send the verification code. Please try again."), { status: 503 });
  }
  return { sent: true as const, retryAfterSeconds: RESEND_SECONDS };
}

export async function verifyRegistrationCode(address: string, code: string) {
  const email = normalizeEmail(address);
  return sequelize.transaction(async (transaction) => {
    const row = await getChallenge(email, transaction);
    if (!row?.codeHash || Number(row.codeSecondsLeft) <= 0) {
      return { error: "This code has expired. Request a new code." } as const;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return { error: "Too many attempts. Request a new code." } as const;
    }
    const valid = timingSafeEqualHex(row.codeHash, otpHash(email, code));
    if (!valid) {
      await sequelize.query(
        "UPDATE registration_email_verifications SET attempts = attempts + 1 WHERE email = :email",
        { replacements: { email }, transaction }
      );
      return {
        error: row.attempts + 1 >= MAX_ATTEMPTS ? "Too many attempts. Request a new code." : "Incorrect code."
      } as const;
    }

    const proof = randomBytes(32).toString("hex");
    await sequelize.query(
      `UPDATE registration_email_verifications
       SET code_hash = NULL, code_expires_at = NULL, proof_hash = :proofHash,
           proof_expires_at = DATE_ADD(NOW(3), INTERVAL :proofMinutes MINUTE)
       WHERE email = :email`,
      { replacements: { email, proofHash: sha256Hex(proof), proofMinutes: PROOF_MINUTES }, transaction }
    );
    return { proof, expiresInSeconds: PROOF_MINUTES * 60 } as const;
  });
}

export async function consumeRegistrationProof(email: string, proof: string | undefined, transaction: Transaction) {
  if (proof) {
    const [, changed] = await sequelize.query(
      `UPDATE registration_email_verifications
       SET proof_hash = NULL, proof_expires_at = NULL, code_hash = NULL, code_expires_at = NULL
       WHERE email = :email AND proof_hash = :proofHash AND proof_expires_at > NOW(3)`,
      { type: QueryTypes.UPDATE, replacements: { email, proofHash: sha256Hex(proof) }, transaction }
    );
    if (changed === 1) return;
  }
  throw Object.assign(new Error("Verify your email before creating your account."), {
    status: 400,
    code: "REGISTRATION_EMAIL_VERIFICATION_REQUIRED"
  });
}
