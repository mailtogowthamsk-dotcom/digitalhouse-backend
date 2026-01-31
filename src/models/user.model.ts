import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

/** User status: PENDING = awaiting approval; APPROVED = can login; REJECTED = denied; PENDING_REVIEW = profile updated, needs re-approval */
export type UserStatus = "PENDING" | "APPROVED" | "REJECTED" | "PENDING_REVIEW";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: number;
  declare fullName: string;
  declare gender: string | null;
  declare dob: Date | null;
  declare email: string;
  declare mobile: string | null;
  declare occupation: string | null;
  declare location: string | null;
  declare community: string | null;
  declare kulam: string | null;
  declare profilePhoto: string | null;
  declare govtIdType: string | null;
  declare govtIdFile: string | null;
  declare status: UserStatus;
  declare bloodGroup: string | null;
  declare education: string | null;
  declare jobTitle: string | null;
  declare company: string | null;
  declare workLocation: string | null;
  declare skills: string | null;
  declare city: string | null;
  declare district: string | null;
  declare communityRole: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

User.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    fullName: { type: DataTypes.STRING(120), allowNull: false },
    gender: { type: DataTypes.STRING(20), allowNull: true },
    dob: { type: DataTypes.DATEONLY, allowNull: true },
    email: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    mobile: { type: DataTypes.STRING(20), allowNull: true },
    occupation: { type: DataTypes.STRING(80), allowNull: true },
    location: { type: DataTypes.STRING(120), allowNull: true },
    community: { type: DataTypes.STRING(80), allowNull: true },
    kulam: { type: DataTypes.STRING(80), allowNull: true },
    profilePhoto: { type: DataTypes.STRING(500), allowNull: true },
    govtIdType: { type: DataTypes.STRING(40), allowNull: true },
    govtIdFile: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED", "PENDING_REVIEW"),
      allowNull: false,
      defaultValue: "PENDING"
    },
    bloodGroup: { type: DataTypes.STRING(10), allowNull: true },
    education: { type: DataTypes.STRING(120), allowNull: true },
    jobTitle: { type: DataTypes.STRING(80), allowNull: true },
    company: { type: DataTypes.STRING(120), allowNull: true },
    workLocation: { type: DataTypes.STRING(120), allowNull: true },
    skills: { type: DataTypes.STRING(255), allowNull: true },
    city: { type: DataTypes.STRING(80), allowNull: true },
    district: { type: DataTypes.STRING(80), allowNull: true },
    communityRole: { type: DataTypes.STRING(80), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "users", timestamps: true }
);
