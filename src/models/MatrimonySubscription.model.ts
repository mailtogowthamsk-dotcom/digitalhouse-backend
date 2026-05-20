import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { MatrimonyPlanCode } from "../constants/matrimony-monetization.constants";

export type MatrimonySubscriptionStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";

export class MatrimonySubscription extends Model<
  InferAttributes<MatrimonySubscription>,
  InferCreationAttributes<MatrimonySubscription>
> {
  declare id: number;
  declare userId: number;
  declare plan: MatrimonyPlanCode;
  declare status: MatrimonySubscriptionStatus;
  declare durationMonths: number;
  declare startsAt: Date;
  declare endsAt: Date;
  declare paymentRef: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonySubscription.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    plan: {
      type: DataTypes.ENUM("FREE", "GOLD", "PLATINUM"),
      allowNull: false,
      defaultValue: "FREE"
    },
    status: {
      type: DataTypes.ENUM("ACTIVE", "EXPIRED", "CANCELLED"),
      allowNull: false,
      defaultValue: "ACTIVE"
    },
    durationMonths: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 6,
      field: "duration_months"
    },
    startsAt: { type: DataTypes.DATE, allowNull: false, field: "starts_at" },
    endsAt: { type: DataTypes.DATE, allowNull: false, field: "ends_at" },
    paymentRef: { type: DataTypes.STRING(128), allowNull: true, field: "payment_ref" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "matrimony_subscriptions", timestamps: false }
);
