import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class JobInterest extends Model<InferAttributes<JobInterest>, InferCreationAttributes<JobInterest>> {
  declare id: number;
  declare postId: number;
  declare fromUserId: number;
  declare message: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

JobInterest.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    fromUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    message: { type: DataTypes.STRING(500), allowNull: true },
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
