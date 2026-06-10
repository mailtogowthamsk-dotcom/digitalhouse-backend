import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type ConnectionStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";

export class MemberConnection extends Model<
  InferAttributes<MemberConnection>,
  InferCreationAttributes<MemberConnection>
> {
  declare id: number;
  declare requesterUserId: number;
  declare recipientUserId: number;
  declare status: ConnectionStatus;
  declare attemptCount: number;
  declare respondedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MemberConnection.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    requesterUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "requester_user_id"
    },
    recipientUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "recipient_user_id"
    },
    status: {
      type: DataTypes.ENUM("PENDING", "ACCEPTED", "REJECTED", "CANCELLED"),
      allowNull: false,
      defaultValue: "PENDING"
    },
    attemptCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      field: "attempt_count"
    },
    respondedAt: { type: DataTypes.DATE, allowNull: true, field: "responded_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "member_connections",
    timestamps: true
  }
);
