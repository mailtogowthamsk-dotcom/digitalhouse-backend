import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
  declare id: number;
  declare senderId: number;
  declare recipientId: number;
  declare body: string;
  declare readAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Message.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    senderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    recipientId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    readAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "messages", timestamps: true }
);
