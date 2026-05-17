import { Op } from "sequelize";
import { User } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { isOnline } from "../realtime/presence";

export type DirectoryUserDto = {
  id: number;
  fullName: string;
  profileImage: string | null;
  online: boolean;
};

const APPROVED = "APPROVED";

async function toDto(u: User): Promise<DirectoryUserDto> {
  const profileImage =
    u.profilePhoto ? (await toSignedUrlIfR2(u.profilePhoto)) ?? u.profilePhoto : null;
  return {
    id: u.id,
    fullName: u.fullName,
    profileImage,
    online: isOnline(u.id)
  };
}

export async function listAllExceptMe(meId: number): Promise<DirectoryUserDto[]> {
  const users = await User.findAll({
    where: { status: APPROVED, id: { [Op.ne]: meId } },
    attributes: ["id", "fullName", "profilePhoto", "status"],
    order: [["fullName", "ASC"]]
  });
  return Promise.all(users.map(toDto));
}

export async function searchByName(meId: number, q: string): Promise<DirectoryUserDto[]> {
  const query = q.trim();
  const users = await User.findAll({
    where: {
      status: APPROVED,
      id: { [Op.ne]: meId },
      fullName: { [Op.like]: `%${query}%` }
    },
    attributes: ["id", "fullName", "profilePhoto", "status"],
    order: [["fullName", "ASC"]],
    limit: 50
  });
  return Promise.all(users.map(toDto));
}

export const usersDirectoryService = { listAllExceptMe, searchByName };

