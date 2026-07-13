import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type {
  MarketplaceStatus,
  MarketplaceIntent,
  MarketplaceCondition
} from "../constants/marketplace.constants";
import type { HelpStatus, HelpUrgency } from "../constants/helpingHands.constants";

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

export const JOB_EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "TEMPORARY"
] as const;
export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPES)[number];

export type { MarketplaceStatus, MarketplaceIntent, MarketplaceCondition };

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
  declare jobCompany: string | null;
  declare jobLocation: string | null;
  declare jobEmploymentType: JobEmploymentType | null;
  declare jobSalaryMin: number | null;
  declare jobSalaryMax: number | null;
  declare marketplaceStatus: MarketplaceStatus | null;
  declare marketplaceIntent: MarketplaceIntent | null;
  declare marketplaceCategory: string | null;
  declare marketplaceCondition: MarketplaceCondition | null;
  declare marketplacePrice: number | null;
  declare marketplaceNegotiable: boolean;
  declare marketplaceDistrict: string | null;
  declare marketplaceAdminNote: string | null;
  declare marketplaceExpiresAt: Date | null;
  /** Progressive reminder: null → D3 → D1 → EXPIRED */
  declare marketplaceExpiryReminder: string | null;
  /** JSON array of image URLs; cover is also mirrored in mediaUrl */
  declare marketplaceGallery: string[] | null;
  declare marketplaceFeatured: boolean;
  declare marketplaceFeaturedAt: Date | null;
  declare helpStatus: HelpStatus | null;
  declare helpCategory: string | null;
  declare helpUrgency: HelpUrgency | null;
  declare helpLocation: string | null;
  declare helpContactPhone: string | null;
  declare helpGallery: string[] | null;
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
    jobCompany: { type: DataTypes.STRING(255), allowNull: true },
    jobLocation: { type: DataTypes.STRING(255), allowNull: true },
    jobEmploymentType: {
      type: DataTypes.ENUM(...JOB_EMPLOYMENT_TYPES),
      allowNull: true
    },
    jobSalaryMin: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    jobSalaryMax: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    marketplaceStatus: { type: DataTypes.STRING(32), allowNull: true },
    marketplaceIntent: { type: DataTypes.STRING(32), allowNull: true },
    marketplaceCategory: { type: DataTypes.STRING(64), allowNull: true },
    marketplaceCondition: { type: DataTypes.STRING(32), allowNull: true },
    marketplacePrice: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    marketplaceNegotiable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    marketplaceDistrict: { type: DataTypes.STRING(255), allowNull: true },
    marketplaceAdminNote: { type: DataTypes.TEXT, allowNull: true },
    marketplaceExpiresAt: { type: DataTypes.DATE, allowNull: true },
    marketplaceExpiryReminder: { type: DataTypes.STRING(16), allowNull: true },
    marketplaceGallery: { type: DataTypes.JSON, allowNull: true },
    marketplaceFeatured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    marketplaceFeaturedAt: { type: DataTypes.DATE, allowNull: true },
    helpStatus: { type: DataTypes.STRING(32), allowNull: true },
    helpCategory: { type: DataTypes.STRING(64), allowNull: true },
    helpUrgency: { type: DataTypes.STRING(16), allowNull: true },
    helpLocation: { type: DataTypes.STRING(255), allowNull: true },
    helpContactPhone: { type: DataTypes.STRING(32), allowNull: true },
    helpGallery: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "posts", timestamps: true }
);
