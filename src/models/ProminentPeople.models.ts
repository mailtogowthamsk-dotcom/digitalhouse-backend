import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class ProminentCategory extends Model<
  InferAttributes<ProminentCategory>,
  InferCreationAttributes<ProminentCategory>
> {
  declare id: number;
  declare code: string;
  declare label: string;
  declare color: string;
  declare sortOrder: number;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ProminentCategory.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    color: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "#2563EB" },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "prominent_categories",
    timestamps: true,
    indexes: [{ fields: ["is_active", "sort_order"] }]
  }
);

export class ProminentPerson extends Model<
  InferAttributes<ProminentPerson>,
  InferCreationAttributes<ProminentPerson>
> {
  declare id: number;
  declare fullName: string;
  declare categoryId: number;
  declare occupation: string | null;
  declare currentDesignation: string | null;
  declare shortDescription: string | null;
  declare biography: string | null;
  declare education: string | null;
  declare achievements: string | null;
  declare awards: string | null;
  declare communityContribution: string | null;
  declare profileImageKey: string | null;
  declare heroImageKey: string | null;
  declare isFeatured: boolean;
  declare isPublished: boolean;
  declare featuredSortOrder: number;
  declare sortOrder: number;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare publishedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ProminentPerson.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    fullName: { type: DataTypes.STRING(160), allowNull: false, field: "full_name" },
    categoryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "category_id" },
    occupation: { type: DataTypes.STRING(160), allowNull: true },
    currentDesignation: {
      type: DataTypes.STRING(200),
      allowNull: true,
      field: "current_designation"
    },
    shortDescription: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: "short_description"
    },
    biography: { type: DataTypes.TEXT, allowNull: true },
    education: { type: DataTypes.TEXT, allowNull: true },
    achievements: { type: DataTypes.TEXT, allowNull: true },
    awards: { type: DataTypes.TEXT, allowNull: true },
    communityContribution: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "community_contribution"
    },
    profileImageKey: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: "profile_image_key"
    },
    heroImageKey: { type: DataTypes.STRING(500), allowNull: true, field: "hero_image_key" },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_featured"
    },
    isPublished: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_published"
    },
    featuredSortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "featured_sort_order"
    },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: "published_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "prominent_people",
    timestamps: true,
    indexes: [
      { fields: ["is_published", "created_at"] },
      { fields: ["is_featured", "is_published", "featured_sort_order"] },
      { fields: ["category_id", "is_published"] },
      { fields: ["full_name"] },
      { fields: ["occupation"] }
    ]
  }
);

export class ProminentGalleryItem extends Model<
  InferAttributes<ProminentGalleryItem>,
  InferCreationAttributes<ProminentGalleryItem>
> {
  declare id: number;
  declare personId: number;
  declare imageKey: string;
  declare caption: string | null;
  declare sortOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ProminentGalleryItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    personId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "person_id" },
    imageKey: { type: DataTypes.STRING(500), allowNull: false, field: "image_key" },
    caption: { type: DataTypes.STRING(255), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "prominent_gallery",
    timestamps: true,
    indexes: [{ fields: ["person_id", "sort_order"] }]
  }
);

export class ProminentTimelineEntry extends Model<
  InferAttributes<ProminentTimelineEntry>,
  InferCreationAttributes<ProminentTimelineEntry>
> {
  declare id: number;
  declare personId: number;
  declare year: string;
  declare title: string;
  declare description: string | null;
  declare sortOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ProminentTimelineEntry.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    personId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "person_id" },
    year: { type: DataTypes.STRING(20), allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "prominent_timeline",
    timestamps: true,
    indexes: [{ fields: ["person_id", "sort_order"] }]
  }
);
