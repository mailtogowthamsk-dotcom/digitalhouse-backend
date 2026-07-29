import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class SystemSchedulerJob extends Model<
  InferAttributes<SystemSchedulerJob>,
  InferCreationAttributes<SystemSchedulerJob>
> {
  declare id: number;
  declare jobKey: string;
  declare name: string;
  declare module: string;
  declare description: string;
  declare fileLocation: string;
  /** null = follow env default; true/false = admin override */
  declare enabledOverride: boolean | null;
  declare successCount: number;
  declare failureCount: number;
  declare lastRunAt: Date | null;
  declare lastSuccessAt: Date | null;
  declare lastFailureAt: Date | null;
  declare lastDurationMs: number | null;
  declare totalDurationMs: number;
  declare lastError: string | null;
  declare lastHeartbeatAt: Date | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SystemSchedulerJob.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jobKey: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: "job_key" },
    name: { type: DataTypes.STRING(128), allowNull: false },
    module: { type: DataTypes.STRING(64), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: false },
    fileLocation: { type: DataTypes.STRING(255), allowNull: false, field: "file_location" },
    enabledOverride: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: null,
      field: "enabled_override"
    },
    successCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "success_count"
    },
    failureCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "failure_count"
    },
    lastRunAt: { type: DataTypes.DATE, allowNull: true, field: "last_run_at" },
    lastSuccessAt: { type: DataTypes.DATE, allowNull: true, field: "last_success_at" },
    lastFailureAt: { type: DataTypes.DATE, allowNull: true, field: "last_failure_at" },
    lastDurationMs: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "last_duration_ms"
    },
    totalDurationMs: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "total_duration_ms"
    },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: "last_error" },
    lastHeartbeatAt: { type: DataTypes.DATE, allowNull: true, field: "last_heartbeat_at" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "system_scheduler_jobs", timestamps: true }
);

export class SystemSchedulerRun extends Model<
  InferAttributes<SystemSchedulerRun>,
  InferCreationAttributes<SystemSchedulerRun>
> {
  declare id: number;
  declare jobKey: string;
  declare startedAt: Date;
  declare finishedAt: Date | null;
  declare durationMs: number | null;
  declare status: string;
  declare error: string | null;
  declare recordsProcessed: number;
  declare triggerType: string;
  declare executedBy: string | null;
  declare createdAt: Date;
}

SystemSchedulerRun.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jobKey: { type: DataTypes.STRING(64), allowNull: false, field: "job_key" },
    startedAt: { type: DataTypes.DATE, allowNull: false, field: "started_at" },
    finishedAt: { type: DataTypes.DATE, allowNull: true, field: "finished_at" },
    durationMs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "duration_ms" },
    status: {
      type: DataTypes.ENUM("RUNNING", "SUCCESS", "FAILURE", "SKIPPED"),
      allowNull: false,
      defaultValue: "RUNNING"
    },
    error: { type: DataTypes.TEXT, allowNull: true },
    recordsProcessed: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "records_processed"
    },
    triggerType: {
      type: DataTypes.ENUM("automatic", "manual"),
      allowNull: false,
      defaultValue: "automatic",
      field: "trigger_type"
    },
    executedBy: { type: DataTypes.STRING(191), allowNull: true, field: "executed_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "system_scheduler_runs",
    timestamps: true,
    updatedAt: false
  }
);
