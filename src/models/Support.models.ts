import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type {
  SupportTicketType,
  SupportTicketStatus,
  SupportPriority,
  SupportBugCategory
} from "../constants/support.constants";
import {
  SUPPORT_TICKET_TYPES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_PRIORITIES,
  SUPPORT_BUG_CATEGORIES
} from "../constants/support.constants";

export class SupportTicket extends Model<
  InferAttributes<SupportTicket>,
  InferCreationAttributes<SupportTicket>
> {
  declare id: number;
  declare userId: number;
  declare type: SupportTicketType;
  declare category: SupportBugCategory | null;
  declare title: string;
  declare description: string;
  declare status: SupportTicketStatus;
  declare priority: SupportPriority;
  declare screenshotUrl: string | null;
  declare recordingUrl: string | null;
  declare metadata: Record<string, unknown> | null;
  declare assignedAdminId: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare resolvedAt: Date | null;
}

SupportTicket.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.ENUM(...SUPPORT_TICKET_TYPES), allowNull: false },
    category: {
      type: DataTypes.ENUM(...SUPPORT_BUG_CATEGORIES),
      allowNull: true
    },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM(...SUPPORT_TICKET_STATUSES),
      allowNull: false,
      defaultValue: "OPEN"
    },
    priority: {
      type: DataTypes.ENUM(...SUPPORT_PRIORITIES),
      allowNull: false,
      defaultValue: "NORMAL"
    },
    screenshotUrl: { type: DataTypes.STRING(500), allowNull: true },
    recordingUrl: { type: DataTypes.STRING(500), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    assignedAdminId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    resolvedAt: { type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "support_tickets",
    indexes: [
      { fields: ["userId"] },
      { fields: ["status"] },
      { fields: ["type"] },
      { fields: ["category"] },
      { fields: ["createdAt"] }
    ]
  }
);

export class SupportTicketMessage extends Model<
  InferAttributes<SupportTicketMessage>,
  InferCreationAttributes<SupportTicketMessage>
> {
  declare id: number;
  declare ticketId: number;
  declare authorType: "USER" | "ADMIN";
  declare authorUserId: number | null;
  declare body: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SupportTicketMessage.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    authorType: { type: DataTypes.ENUM("USER", "ADMIN"), allowNull: false },
    authorUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "support_ticket_messages",
    indexes: [{ fields: ["ticketId"] }]
  }
);

export class SupportFaq extends Model<InferAttributes<SupportFaq>, InferCreationAttributes<SupportFaq>> {
  declare id: number;
  declare question: string;
  declare answer: string;
  declare category: string;
  declare sortOrder: number;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SupportFaq.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    question: { type: DataTypes.STRING(300), allowNull: false },
    answer: { type: DataTypes.TEXT, allowNull: false },
    category: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "General" },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "support_faqs" }
);

export class SupportGuide extends Model<
  InferAttributes<SupportGuide>,
  InferCreationAttributes<SupportGuide>
> {
  declare id: number;
  declare title: string;
  declare summary: string | null;
  declare sortOrder: number;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SupportGuide.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "support_guides" }
);

export class SupportGuideStep extends Model<
  InferAttributes<SupportGuideStep>,
  InferCreationAttributes<SupportGuideStep>
> {
  declare id: number;
  declare guideId: number;
  declare sortOrder: number;
  declare title: string;
  declare body: string;
  declare imageUrl: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SupportGuideStep.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    guideId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    title: { type: DataTypes.STRING(200), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "support_guide_steps", indexes: [{ fields: ["guideId"] }] }
);

/** Singleton-style contact channels (id always 1). */
export class SupportContactConfig extends Model<
  InferAttributes<SupportContactConfig>,
  InferCreationAttributes<SupportContactConfig>
> {
  declare id: number;
  declare email: string | null;
  declare whatsappNumber: string | null;
  declare phoneNumber: string | null;
  declare chatEnabled: boolean;
  declare emailEnabled: boolean;
  declare whatsappEnabled: boolean;
  declare callEnabled: boolean;
  declare supportNote: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SupportContactConfig.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING(191), allowNull: true },
    whatsappNumber: { type: DataTypes.STRING(40), allowNull: true },
    phoneNumber: { type: DataTypes.STRING(40), allowNull: true },
    chatEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    emailEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    whatsappEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    callEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    supportNote: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "support_contact_config" }
);
