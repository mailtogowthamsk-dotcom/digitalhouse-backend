import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const POST_TYPES = [
  "ANNOUNCEMENT",
  "JOB",
  "MARKETPLACE",
  "MATRIMONY",
  "ACHIEVEMENT",
  "MEETUP",
  "HELP_REQUEST",
  "ENTERTAINMENT"
] as const;
export type PostType = (typeof POST_TYPES)[number];

export const JOB_STATUSES = ["OPEN", "CLOSED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export class Post extends Model<InferAttributes<Post>, InferCreationAttributes<Post>> {
  declare id: number;
  declare userId: number;
  declare postType: PostType;
  declare title: string;
  declare description: string | null;
  declare mediaUrl: string | null;
  declare pinned: boolean;
  declare urgent: boolean;
  declare meetupAt: Date | null;
  declare jobStatus: JobStatus | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Post.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postType: {
      type: DataTypes.ENUM(...POST_TYPES),
      allowNull: false
    },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    mediaUrl: { type: DataTypes.STRING(500), allowNull: true },
    pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    urgent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    meetupAt: { type: DataTypes.DATE, allowNull: true },
    jobStatus: {
      type: DataTypes.ENUM("OPEN", "CLOSED"),
      allowNull: true
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "posts", timestamps: true }
);
