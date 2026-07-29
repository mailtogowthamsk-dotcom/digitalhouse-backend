import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const JOB_AUDIT_ACTOR_TYPES = ["ADMIN", "USER", "SYSTEM"] as const;
export type JobAuditActorType = (typeof JOB_AUDIT_ACTOR_TYPES)[number];

export class JobAuditLog extends Model<
  InferAttributes<JobAuditLog>,
  InferCreationAttributes<JobAuditLog>
> {
  declare id: number;
  declare postId: number | null;
  declare jobInterestId: number | null;
  declare actorType: JobAuditActorType;
  declare actorUserId: number | null;
  declare actorEmail: string | null;
  declare action: string;
  declare statusFrom: string | null;
  declare statusTo: string | null;
  declare note: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: Date;
}

JobAuditLog.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "post_id" },
    jobInterestId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "job_interest_id" },
    actorType: {
      type: DataTypes.ENUM(...JOB_AUDIT_ACTOR_TYPES),
      allowNull: false,
      field: "actor_type"
    },
    actorUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "actor_user_id" },
    actorEmail: { type: DataTypes.STRING(191), allowNull: true, field: "actor_email" },
    action: { type: DataTypes.STRING(64), allowNull: false },
    statusFrom: { type: DataTypes.STRING(64), allowNull: true, field: "status_from" },
    statusTo: { type: DataTypes.STRING(64), allowNull: true, field: "status_to" },
    note: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "job_audit_logs",
    timestamps: true,
    updatedAt: false,
    indexes: [
      { fields: ["post_id", "created_at"], name: "idx_job_audit_post_created" },
      { fields: ["job_interest_id", "created_at"], name: "idx_job_audit_interest_created" }
    ]
  }
);
