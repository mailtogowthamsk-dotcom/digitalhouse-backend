import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class RazorpayWebhookEvent extends Model<
  InferAttributes<RazorpayWebhookEvent>,
  InferCreationAttributes<RazorpayWebhookEvent>
> {
  declare id: number;
  declare eventId: string;
  declare eventType: string;
  declare processedAt: Date;
}

RazorpayWebhookEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    eventId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: "event_id" },
    eventType: { type: DataTypes.STRING(64), allowNull: false, field: "event_type" },
    processedAt: { type: DataTypes.DATE, allowNull: false, field: "processed_at" }
  },
  { sequelize, tableName: "razorpay_webhook_events", timestamps: false }
);
