import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type MatrimonyWorkflowStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED"
  | "CHANGES_REQUESTED"
  | "RESUBMITTED";

export type MatrimonyChangeRequestInfo = {
  comment: string;
  sections: string[];
  requestedAt: string;
  requestedBy: string;
};

export type MatrimonyVerificationState = {
  genuineCommunityMember?: { checked: boolean; by?: string; at?: string };
  kulamVerified?: { checked: boolean; by?: string; at?: string };
  horoscopeVerified?: { checked: boolean; by?: string; at?: string };
  familyVerified?: { checked: boolean; by?: string; at?: string };
  profileQualityApproved?: { checked: boolean; by?: string; at?: string };
};

/** Columns present in base matrimony-admin-module.sql (before changes-requested migration) */
export const MATRIMONY_META_SAFE_ATTRIBUTES = [
  "id",
  "pendingUpdateId",
  "userId",
  "workflowStatus",
  "assignedReviewer",
  "reviewedBy",
  "rejectionReason",
  "rejectionComment",
  "verification",
  "suspended",
  "createdAt",
  "updatedAt"
] as const;

export class MatrimonyRequestMeta extends Model<
  InferAttributes<MatrimonyRequestMeta>,
  InferCreationAttributes<MatrimonyRequestMeta>
> {
  declare id: number;
  declare pendingUpdateId: number;
  declare userId: number;
  declare workflowStatus: MatrimonyWorkflowStatus;
  declare assignedReviewer: string | null;
  declare reviewedBy: string | null;
  declare rejectionReason: string | null;
  declare rejectionComment: string | null;
  declare verification: MatrimonyVerificationState | null;
  declare suspended: boolean;
  declare changeRequest: MatrimonyChangeRequestInfo | null;
  declare submissionSnapshot: Record<string, unknown> | null;
  declare resubmissionCount: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyRequestMeta.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    pendingUpdateId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      field: "pending_update_id"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    workflowStatus: {
      type: DataTypes.ENUM(
        "DRAFT",
        "SUBMITTED",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "SUSPENDED",
        "CHANGES_REQUESTED",
        "RESUBMITTED"
      ),
      allowNull: false,
      defaultValue: "SUBMITTED",
      field: "workflow_status"
    },
    assignedReviewer: { type: DataTypes.STRING(191), allowNull: true, field: "assigned_reviewer" },
    reviewedBy: { type: DataTypes.STRING(191), allowNull: true, field: "reviewed_by" },
    rejectionReason: { type: DataTypes.STRING(80), allowNull: true, field: "rejection_reason" },
    rejectionComment: { type: DataTypes.TEXT, allowNull: true, field: "rejection_comment" },
    verification: { type: DataTypes.JSON, allowNull: true },
    suspended: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    changeRequest: { type: DataTypes.JSON, allowNull: true, field: "change_request" },
    submissionSnapshot: { type: DataTypes.JSON, allowNull: true, field: "submission_snapshot" },
    resubmissionCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "resubmission_count"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "matrimony_request_meta",
    timestamps: true,
    underscored: true,
    /** Avoid SELECT/INSERT errors when optional migration columns are not applied yet */
    defaultScope: {
      attributes: [...MATRIMONY_META_SAFE_ATTRIBUTES]
    },
    scopes: {
      /** Use after running matrimony-changes-requested.sql */
      withChangeTracking: {
        attributes: [
          ...MATRIMONY_META_SAFE_ATTRIBUTES,
          "changeRequest",
          "submissionSnapshot",
          "resubmissionCount"
        ]
      }
    }
  }
);
