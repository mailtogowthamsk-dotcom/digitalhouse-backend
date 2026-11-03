/**
 * Moderators may open User Management only for members assigned to their
 * active support-team row (same email as the admin login).
 */
import { Op, QueryTypes, type WhereOptions } from "sequelize";
import { sequelize } from "../../config/db";
import type { AdminRole } from "../../constants/adminRoles.constants";

export function assignedUsersWhere(email: string): WhereOptions {
  const safe = sequelize.escape(email.trim().toLowerCase());
  return {
    id: {
      [Op.in]: sequelize.literal(`(
        SELECT a.userId
        FROM registration_request_assignments a
        INNER JOIN support_team_members m ON m.id = a.assignedMemberId
        WHERE m.email = ${safe}
          AND m.isActive = 1
          AND m.removedAt IS NULL
      )`)
    }
  };
}

export async function moderatorMayViewUser(email: string, userId: number): Promise<boolean> {
  const rows = await sequelize.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM registration_request_assignments a
     INNER JOIN support_team_members m ON m.id = a.assignedMemberId
     WHERE a.userId = :userId
       AND m.email = :email
       AND m.isActive = 1
       AND m.removedAt IS NULL
     LIMIT 1`,
    {
      replacements: { userId, email: email.trim().toLowerCase() },
      type: QueryTypes.SELECT
    }
  );
  return rows.length > 0;
}

/** True when this moderator must not see the member. Other roles are never blocked here. */
export async function moderatorBlockedFromUser(
  role: AdminRole,
  email: string | null,
  userId: number
): Promise<boolean> {
  if (role !== "MODERATOR") return false;
  if (!email) return true;
  return !(await moderatorMayViewUser(email, userId));
}
