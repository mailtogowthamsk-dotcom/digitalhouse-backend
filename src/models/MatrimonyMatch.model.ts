import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type MatrimonyMatchStatus = "ACTIVE" | "UNMATCHED" | "BLOCKED";

export class MatrimonyMatch extends Model<
  InferAttributes<MatrimonyMatch>,
  InferCreationAttributes<MatrimonyMatch>
> {
  declare id: number;
  declare userLowId: number;
  declare userHighId: number;
  declare status: MatrimonyMatchStatus;
  declare chatEnabled: boolean;
  declare contactRevealed: boolean;
  declare horoscopeShared: boolean;
  declare matchedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyMatch.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userLowId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_low_id" },
    userHighId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_high_id" },
    status: {
      type: DataTypes.ENUM("ACTIVE", "UNMATCHED", "BLOCKED"),
      allowNull: false,
      defaultValue: "ACTIVE"
    },
    chatEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "chat_enabled"
    },
    contactRevealed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "contact_revealed"
    },
    horoscopeShared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "horoscope_shared"
    },
    matchedAt: { type: DataTypes.DATE, allowNull: false, field: "matched_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "matrimony_matches",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
