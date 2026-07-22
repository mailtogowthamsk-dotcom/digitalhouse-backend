import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MemberExpertiseSelection extends Model<
  InferAttributes<MemberExpertiseSelection>,
  InferCreationAttributes<MemberExpertiseSelection>
> {
  declare id: number;
  declare userId: number;
  declare expertiseItemId: number;
  declare createdAt: Date;
}

MemberExpertiseSelection.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    expertiseItemId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "expertise_item_id"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "member_expertise_selections",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false
  }
);
