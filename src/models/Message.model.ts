import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
  declare id: number;
  declare senderId: number;
  declare recipientId: number;
  declare body: string;
  declare sharedPostId: number | null;
  declare sharedStoryId: number | null;
  declare clientId: string | null;
  declare deliveredAt: Date | null;
  declare readAt: Date | null;
  declare deletedForEveryoneAt: Date | null;
  declare deletedBy: number | null;
  declare deletedForSenderAt: Date | null;
  declare deletedForRecipientAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Message.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    senderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    recipientId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    sharedPostId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    sharedStoryId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    clientId: { type: DataTypes.STRING(64), allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    deletedForEveryoneAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: "deleted_for_everyone_at"
    },
    deletedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      field: "deleted_by"
    },
    deletedForSenderAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: "deleted_for_sender_at"
    },
    deletedForRecipientAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: "deleted_for_recipient_at"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "messages",
    timestamps: true,
    indexes: [
      { name: "idx_messages_pair_created", fields: ["senderId", "recipientId", "createdAt"] },
      { name: "idx_messages_recipient_read", fields: ["recipientId", "readAt"] }
      // Soft-delete index lives in migration (snake_case column names).
    ]
  }
);
