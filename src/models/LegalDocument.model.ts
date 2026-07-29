import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import {
  LEGAL_CONTENT_FORMATS,
  LEGAL_DOCUMENT_STATUSES
} from "../constants/legal.constants";

export class LegalDocumentType extends Model<
  InferAttributes<LegalDocumentType>,
  InferCreationAttributes<LegalDocumentType>
> {
  declare id: number;
  declare documentKey: string;
  declare title: string;
  declare slug: string;
  declare description: string | null;
  declare sortOrder: number;
  declare requiredAtRegistration: boolean;
  declare requiresReacceptance: boolean;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

LegalDocumentType.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    documentKey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: "document_key"
    },
    title: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(500), allowNull: true },
    sortOrder: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 100,
      field: "sort_order"
    },
    requiredAtRegistration: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "required_at_registration"
    },
    requiresReacceptance: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "requires_reacceptance"
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "legal_document_types", timestamps: true }
);

export class LegalDocument extends Model<
  InferAttributes<LegalDocument>,
  InferCreationAttributes<LegalDocument>
> {
  declare id: number;
  declare documentKey: string;
  declare title: string;
  declare slug: string;
  declare content: string;
  declare contentFormat: string;
  declare version: string;
  declare versionMajor: number;
  declare versionMinor: number;
  declare status: string;
  declare isPublished: boolean;
  declare publishedAt: Date | null;
  declare changeSummary: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

LegalDocument.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    documentKey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "document_key"
    },
    title: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(120), allowNull: false },
    content: { type: DataTypes.TEXT("long"), allowNull: false },
    contentFormat: {
      type: DataTypes.ENUM(...LEGAL_CONTENT_FORMATS),
      allowNull: false,
      defaultValue: "html",
      field: "content_format"
    },
    version: { type: DataTypes.STRING(20), allowNull: false },
    versionMajor: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      field: "version_major"
    },
    versionMinor: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "version_minor"
    },
    status: {
      type: DataTypes.ENUM(...LEGAL_DOCUMENT_STATUSES),
      allowNull: false,
      defaultValue: "DRAFT"
    },
    isPublished: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_published"
    },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: "published_at" },
    changeSummary: { type: DataTypes.STRING(500), allowNull: true, field: "change_summary" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "legal_documents",
    timestamps: true,
    indexes: [
      { fields: ["document_key", "version"], unique: true },
      { fields: ["document_key", "is_published"] },
      { fields: ["slug", "is_published"] },
      { fields: ["status"] }
    ]
  }
);

export class LegalDocumentAcceptance extends Model<
  InferAttributes<LegalDocumentAcceptance>,
  InferCreationAttributes<LegalDocumentAcceptance>
> {
  declare id: number;
  declare userId: number;
  declare documentKey: string;
  declare documentId: number;
  declare version: string;
  declare source: string;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare acceptedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

LegalDocumentAcceptance.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    documentKey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "document_key"
    },
    documentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "document_id"
    },
    version: { type: DataTypes.STRING(20), allowNull: false },
    source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "settings" },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true, field: "ip_address" },
    userAgent: { type: DataTypes.STRING(500), allowNull: true, field: "user_agent" },
    acceptedAt: { type: DataTypes.DATE, allowNull: false, field: "accepted_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "legal_document_acceptances",
    timestamps: true,
    indexes: [
      { fields: ["user_id", "document_key", "version"], unique: true },
      { fields: ["user_id", "document_key"] },
      { fields: ["document_id"] }
    ]
  }
);
