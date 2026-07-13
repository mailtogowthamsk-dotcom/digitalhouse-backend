import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class HelpAppreciation extends Model<
  InferAttributes<HelpAppreciation>,
  InferCreationAttributes<HelpAppreciation>
> {
  declare id: number;
  declare postId: number;
  declare helperUserId: number;
  declare fromUserId: number;
  declare message: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

HelpAppreciation.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    helperUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    fromUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    message: { type: DataTypes.STRING(500), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "help_appreciations",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["postId", "helperUserId"], name: "uq_help_appreciation_post_helper" },
      { fields: ["helperUserId"], name: "idx_help_appreciations_helper" },
      { fields: ["fromUserId"], name: "idx_help_appreciations_from" }
    ]
  }
);
