import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class UsernameReservation extends Model<
  InferAttributes<UsernameReservation>,
  InferCreationAttributes<UsernameReservation>
> {
  declare id: number;
  declare username: string;
  declare reservedForUserId: number;
  declare reservedUntil: Date;
  declare createdAt: Date;
}

UsernameReservation.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    reservedForUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "reserved_for_user_id"
    },
    reservedUntil: { type: DataTypes.DATE, allowNull: false, field: "reserved_until" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "username_reservations", timestamps: false, updatedAt: false }
);
