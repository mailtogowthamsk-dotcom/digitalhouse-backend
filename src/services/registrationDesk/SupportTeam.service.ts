import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/db";
import { normalizeNotifyEmail } from "./registrationDesk.logic";

export type SupportMemberDto = {
  id: number;
  name: string | null;
  email: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemberRow = {
  id: number;
  name: string | null;
  email: string;
  isActive: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function toDto(row: MemberRow): SupportMemberDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: Boolean(row.isActive),
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  };
}

async function writeEvent(memberId: number, action: string, actorEmail: string): Promise<void> {
  await sequelize.query(
    `INSERT INTO support_team_events (memberId, action, actorEmail, createdAt)
     VALUES (:memberId, :action, :actorEmail, NOW(3))`,
    { replacements: { memberId, action, actorEmail } }
  );
}

export async function listSupportMembers(): Promise<SupportMemberDto[]> {
  const rows = await sequelize.query<MemberRow>(
    `SELECT id, name, email, isActive, createdBy, createdAt, updatedAt
     FROM support_team_members
     WHERE removedAt IS NULL
     ORDER BY createdAt DESC, id DESC`,
    { type: QueryTypes.SELECT }
  );
  return rows.map(toDto);
}

export async function addSupportMember(input: {
  name?: string | null;
  email: string;
  actorEmail: string;
}): Promise<SupportMemberDto> {
  const email = normalizeNotifyEmail(input.email);
  if (!email) throw httpError("Enter a valid email address.", 400);
  const name = input.name?.trim() ? input.name.trim().slice(0, 120) : null;
  const existing = await sequelize.query<{ id: number; removedAt: Date | null }>(
    `SELECT id, removedAt FROM support_team_members WHERE email = :email LIMIT 1`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  if (existing[0] && !existing[0].removedAt) {
    throw httpError("That email is already on the support team.", 409);
  }
  if (existing[0]) {
    await sequelize.query(
      `UPDATE support_team_members
       SET name = :name, isActive = 1, removedAt = NULL, updatedAt = NOW(3)
       WHERE id = :id`,
      { replacements: { id: existing[0].id, name } }
    );
    await writeEvent(existing[0].id, "CREATED", input.actorEmail);
    const revived = await sequelize.query<MemberRow>(
      `SELECT id, name, email, isActive, createdBy, createdAt, updatedAt
       FROM support_team_members WHERE id = :id LIMIT 1`,
      { replacements: { id: existing[0].id }, type: QueryTypes.SELECT }
    );
    return toDto(revived[0]!);
  }
  try {
    await sequelize.query(
      `INSERT INTO support_team_members (name, email, isActive, createdBy, createdAt, updatedAt)
       VALUES (:name, :email, 1, :actor, NOW(3), NOW(3))`,
      { replacements: { name, email, actor: input.actorEmail } }
    );
  } catch (err) {
    const code = (err as { parent?: { code?: string } })?.parent?.code;
    if (code === "ER_DUP_ENTRY") throw httpError("That email is already on the support team.", 409);
    throw err;
  }
  const created = await sequelize.query<MemberRow>(
    `SELECT id, name, email, isActive, createdBy, createdAt, updatedAt
     FROM support_team_members WHERE email = :email LIMIT 1`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  const row = created[0];
  if (!row) throw httpError("Could not save support member.", 500);
  await writeEvent(row.id, "CREATED", input.actorEmail);
  return toDto(row);
}

export async function updateSupportMember(
  id: number,
  input: { name?: string | null; email?: string; isActive?: boolean },
  actorEmail: string
): Promise<SupportMemberDto> {
  const existing = await sequelize.query<MemberRow>(
    `SELECT id, name, email, isActive, createdBy, createdAt, updatedAt
     FROM support_team_members WHERE id = :id AND removedAt IS NULL LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  const row = existing[0];
  if (!row) throw httpError("Support member not found.", 404);

  const email = input.email !== undefined ? normalizeNotifyEmail(input.email) : row.email;
  if (!email) throw httpError("Enter a valid email address.", 400);
  const name =
    input.name !== undefined ? (input.name?.trim() ? input.name.trim().slice(0, 120) : null) : row.name;
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : row.isActive;

  try {
    await sequelize.query(
      `UPDATE support_team_members
       SET name = :name, email = :email, isActive = :isActive, updatedAt = NOW(3)
       WHERE id = :id AND removedAt IS NULL`,
      { replacements: { id, name, email, isActive } }
    );
  } catch (err) {
    const code = (err as { parent?: { code?: string } })?.parent?.code;
    if (code === "ER_DUP_ENTRY") throw httpError("That email is already on the support team.", 409);
    throw err;
  }

  const action =
    input.isActive === true && !row.isActive
      ? "ACTIVATED"
      : input.isActive === false && row.isActive
        ? "DEACTIVATED"
        : "UPDATED";
  await writeEvent(id, action, actorEmail);

  const updated = await sequelize.query<MemberRow>(
    `SELECT id, name, email, isActive, createdBy, createdAt, updatedAt
     FROM support_team_members WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  return toDto(updated[0]!);
}

export async function removeSupportMember(id: number, actorEmail: string): Promise<void> {
  const existing = await sequelize.query<{ id: number }>(
    `SELECT id FROM support_team_members WHERE id = :id AND removedAt IS NULL LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  if (!existing[0]) throw httpError("Support member not found.", 404);
  await sequelize.query(
    `UPDATE support_team_members
     SET isActive = 0, removedAt = NOW(3), updatedAt = NOW(3)
     WHERE id = :id AND removedAt IS NULL`,
    { replacements: { id } }
  );
  await writeEvent(id, "REMOVED", actorEmail);
}
