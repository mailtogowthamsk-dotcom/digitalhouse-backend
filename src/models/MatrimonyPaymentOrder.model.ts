import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type MatrimonyPaymentPurpose =
  | "SUBSCRIPTION_GOLD"
  | "SUBSCRIPTION_PLATINUM"
  | "CONTACT_REVEAL";

export type MatrimonyPaymentOrderStatus = "CREATED" | "PAID" | "FAILED";

export type MatrimonyPaymentOrderMeta = {
  plan?: "GOLD" | "PLATINUM";
  durationMonths?: number;
  targetUserId?: number;
  matchId?: number | null;
  contactRevealId?: number;
};

export class MatrimonyPaymentOrder extends Model<
  InferAttributes<MatrimonyPaymentOrder>,
  InferCreationAttributes<MatrimonyPaymentOrder>
> {
  declare id: number;
  declare userId: number;
  declare purpose: MatrimonyPaymentPurpose;
  declare amountPaise: number;
  declare currency: string;
  declare razorpayOrderId: string;
  declare razorpayPaymentId: string | null;
  declare status: MatrimonyPaymentOrderStatus;
  declare meta: MatrimonyPaymentOrderMeta | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyPaymentOrder.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    purpose: {
      type: DataTypes.ENUM("SUBSCRIPTION_GOLD", "SUBSCRIPTION_PLATINUM", "CONTACT_REVEAL"),
      allowNull: false
    },
    amountPaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "amount_paise" },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    razorpayOrderId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "razorpay_order_id"
    },
    razorpayPaymentId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "razorpay_payment_id"
    },
    status: {
      type: DataTypes.ENUM("CREATED", "PAID", "FAILED"),
      allowNull: false,
      defaultValue: "CREATED"
    },
    meta: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "matrimony_payment_orders", timestamps: false }
);
