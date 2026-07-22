import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const PROFESSIONAL_VISIBILITY = ["PUBLIC", "CONNECTIONS_ONLY", "HIDDEN"] as const;
export type ProfessionalVisibility = (typeof PROFESSIONAL_VISIBILITY)[number];

export class MemberProfessionalIdentity extends Model<
  InferAttributes<MemberProfessionalIdentity>,
  InferCreationAttributes<MemberProfessionalIdentity>
> {
  declare userId: number;
  declare profession: string | null;
  declare company: string | null;
  declare experience: string | null;
  declare skills: string | null;
  declare availableForHelp: boolean;
  declare visibility: ProfessionalVisibility;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MemberProfessionalIdentity.init(
  {
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      field: "user_id"
    },
    profession: { type: DataTypes.STRING(120), allowNull: true },
    company: { type: DataTypes.STRING(160), allowNull: true },
    experience: { type: DataTypes.STRING(80), allowNull: true },
    skills: { type: DataTypes.TEXT, allowNull: true },
    availableForHelp: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "available_for_help"
    },
    visibility: {
      type: DataTypes.ENUM(...PROFESSIONAL_VISIBILITY),
      allowNull: false,
      defaultValue: "PUBLIC"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "member_professional_identities",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
