import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const JOB_APPLICATION_STATUSES = [
  "APPLIED",
  "REVIEWED",
  "SHORTLISTED",
  "REJECTED",
  "SELECTED",
  "WITHDRAWN",
  "INTERVIEW_SCHEDULED"
] as const;
export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number];

export class JobInterest extends Model<InferAttributes<JobInterest>, InferCreationAttributes<JobInterest>> {
  declare id: number;
  declare postId: number;
  declare fromUserId: number;
  declare message: string | null;
  declare status: JobApplicationStatus;
  declare resumeUrl: string | null;
  declare adminNotes: string | null;
  declare employerNotes: string | null;
  declare reviewedBy: string | null;
  declare reviewedAt: Date | null;
  declare shortlistedAt: Date | null;
  declare rejectedAt: Date | null;
  declare selectedAt: Date | null;
  declare withdrawnAt: Date | null;
  declare interviewScheduledAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

JobInterest.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    fromUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    message: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.ENUM(...JOB_APPLICATION_STATUSES),
      allowNull: false,
      defaultValue: "APPLIED"
    },
    resumeUrl: { type: DataTypes.STRING(500), allowNull: true, field: "resume_url" },
    adminNotes: { type: DataTypes.TEXT, allowNull: true, field: "admin_notes" },
    employerNotes: { type: DataTypes.TEXT, allowNull: true, field: "employer_notes" },
    reviewedBy: { type: DataTypes.STRING(191), allowNull: true, field: "reviewed_by" },
    reviewedAt: { type: DataTypes.DATE, allowNull: true, field: "reviewed_at" },
    shortlistedAt: { type: DataTypes.DATE, allowNull: true, field: "shortlisted_at" },
    rejectedAt: { type: DataTypes.DATE, allowNull: true, field: "rejected_at" },
    selectedAt: { type: DataTypes.DATE, allowNull: true, field: "selected_at" },
    withdrawnAt: { type: DataTypes.DATE, allowNull: true, field: "withdrawn_at" },
    interviewScheduledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "interview_scheduled_at"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "job_interests",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["postId", "fromUserId"], name: "uq_job_interest_post_user" },
      { fields: ["postId"], name: "idx_job_interests_post" },
      { fields: ["fromUserId"], name: "idx_job_interests_from" }
    ]
  }
);
