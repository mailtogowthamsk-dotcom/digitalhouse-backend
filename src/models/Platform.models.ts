import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import {
  AD_KINDS,
  APP_PLATFORMS,
  PLATFORM_AUDIENCES,
  PLATFORM_NOTIF_KINDS,
  PLATFORM_NOTIF_STATUSES,
  POPUP_TYPES,
  VERSION_STATUSES
} from "../constants/platform.constants";

export class PlatformAppVersion extends Model<
  InferAttributes<PlatformAppVersion>,
  InferCreationAttributes<PlatformAppVersion>
> {
  declare id: number;
  declare platform: string;
  declare versionName: string;
  declare versionCode: number;
  declare minSupportedVersion: string;
  declare latestVersion: string;
  declare releaseNotes: string | null;
  declare releaseDate: string | null;
  declare storeUrl: string | null;
  declare status: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformAppVersion.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    platform: { type: DataTypes.ENUM(...APP_PLATFORMS), allowNull: false },
    versionName: { type: DataTypes.STRING(32), allowNull: false, field: "version_name" },
    versionCode: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "version_code"
    },
    minSupportedVersion: {
      type: DataTypes.STRING(32),
      allowNull: false,
      field: "min_supported_version"
    },
    latestVersion: { type: DataTypes.STRING(32), allowNull: false, field: "latest_version" },
    releaseNotes: { type: DataTypes.TEXT, allowNull: true, field: "release_notes" },
    releaseDate: { type: DataTypes.DATEONLY, allowNull: true, field: "release_date" },
    storeUrl: { type: DataTypes.STRING(500), allowNull: true, field: "store_url" },
    status: {
      type: DataTypes.ENUM(...VERSION_STATUSES),
      allowNull: false,
      defaultValue: "DRAFT"
    },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_app_versions", timestamps: true }
);

export class PlatformMaintenance extends Model<
  InferAttributes<PlatformMaintenance>,
  InferCreationAttributes<PlatformMaintenance>
> {
  declare id: number;
  declare enabled: boolean;
  declare title: string;
  declare description: string | null;
  declare expectedEndAt: Date | null;
  declare contactInfo: string | null;
  declare scheduledStartAt: Date | null;
  declare activatedAt: Date | null;
  declare deactivatedAt: Date | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformMaintenance.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    title: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "Under Maintenance" },
    description: { type: DataTypes.TEXT, allowNull: true },
    expectedEndAt: { type: DataTypes.DATE, allowNull: true, field: "expected_end_at" },
    contactInfo: { type: DataTypes.STRING(255), allowNull: true, field: "contact_info" },
    scheduledStartAt: { type: DataTypes.DATE, allowNull: true, field: "scheduled_start_at" },
    activatedAt: { type: DataTypes.DATE, allowNull: true, field: "activated_at" },
    deactivatedAt: { type: DataTypes.DATE, allowNull: true, field: "deactivated_at" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_maintenance", timestamps: true }
);

export class PlatformNotification extends Model<
  InferAttributes<PlatformNotification>,
  InferCreationAttributes<PlatformNotification>
> {
  declare id: number;
  declare kind: string;
  declare title: string;
  declare body: string;
  declare imageUrl: string | null;
  declare deepLink: string | null;
  declare audience: string;
  declare status: string;
  declare scheduledAt: Date | null;
  declare sentAt: Date | null;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformNotification.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    kind: {
      type: DataTypes.ENUM(...PLATFORM_NOTIF_KINDS),
      allowNull: false,
      defaultValue: "GLOBAL"
    },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: { type: DataTypes.STRING(500), allowNull: true, field: "image_url" },
    deepLink: { type: DataTypes.STRING(500), allowNull: true, field: "deep_link" },
    audience: {
      type: DataTypes.ENUM(...PLATFORM_AUDIENCES),
      allowNull: false,
      defaultValue: "ALL"
    },
    status: {
      type: DataTypes.ENUM(...PLATFORM_NOTIF_STATUSES),
      allowNull: false,
      defaultValue: "DRAFT"
    },
    scheduledAt: { type: DataTypes.DATE, allowNull: true, field: "scheduled_at" },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: "sent_at" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_notifications", timestamps: true }
);

export class PlatformAlertPopup extends Model<
  InferAttributes<PlatformAlertPopup>,
  InferCreationAttributes<PlatformAlertPopup>
> {
  declare id: number;
  declare title: string;
  declare body: string;
  declare imageUrl: string | null;
  declare popupType: string;
  declare acknowledgementRequired: boolean;
  declare scheduledAt: Date | null;
  declare expiresAt: Date | null;
  declare isActive: boolean;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformAlertPopup.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: { type: DataTypes.STRING(500), allowNull: true, field: "image_url" },
    popupType: {
      type: DataTypes.ENUM(...POPUP_TYPES),
      allowNull: false,
      defaultValue: "ONE_TIME",
      field: "popup_type"
    },
    acknowledgementRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "acknowledgement_required"
    },
    scheduledAt: { type: DataTypes.DATE, allowNull: true, field: "scheduled_at" },
    expiresAt: { type: DataTypes.DATE, allowNull: true, field: "expires_at" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_alert_popups", timestamps: true }
);

export class PlatformPopupAck extends Model<
  InferAttributes<PlatformPopupAck>,
  InferCreationAttributes<PlatformPopupAck>
> {
  declare id: number;
  declare popupId: number;
  declare userId: number;
  declare acknowledgedAt: Date;
}

PlatformPopupAck.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    popupId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "popup_id" },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    acknowledgedAt: { type: DataTypes.DATE, allowNull: false, field: "acknowledged_at" }
  },
  { sequelize, tableName: "platform_popup_acks", timestamps: false }
);

export class PlatformAnnouncement extends Model<
  InferAttributes<PlatformAnnouncement>,
  InferCreationAttributes<PlatformAnnouncement>
> {
  declare id: number;
  declare title: string;
  declare description: string;
  declare bannerImage: string | null;
  declare publishAt: Date;
  declare expiresAt: Date | null;
  declare priority: number;
  declare isActive: boolean;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformAnnouncement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    bannerImage: { type: DataTypes.STRING(500), allowNull: true, field: "banner_image" },
    publishAt: { type: DataTypes.DATE, allowNull: false, field: "publish_at" },
    expiresAt: { type: DataTypes.DATE, allowNull: true, field: "expires_at" },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_announcements", timestamps: true }
);

export class PlatformBanner extends Model<
  InferAttributes<PlatformBanner>,
  InferCreationAttributes<PlatformBanner>
> {
  declare id: number;
  declare message: string;
  declare backgroundColor: string | null;
  declare icon: string | null;
  declare clickAction: string | null;
  declare expiresAt: Date | null;
  declare priority: number;
  declare isActive: boolean;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformBanner.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    message: { type: DataTypes.STRING(255), allowNull: false },
    backgroundColor: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: "#0f172a",
      field: "background_color"
    },
    icon: { type: DataTypes.STRING(64), allowNull: true },
    clickAction: { type: DataTypes.STRING(500), allowNull: true, field: "click_action" },
    expiresAt: { type: DataTypes.DATE, allowNull: true, field: "expires_at" },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_banners", timestamps: true }
);

export class PlatformFeatureFlag extends Model<
  InferAttributes<PlatformFeatureFlag>,
  InferCreationAttributes<PlatformFeatureFlag>
> {
  declare id: number;
  declare code: string;
  declare label: string;
  declare enabled: boolean;
  declare platformsJson: string[] | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformFeatureFlag.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    platformsJson: { type: DataTypes.JSON, allowNull: true, field: "platforms_json" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_feature_flags", timestamps: true }
);

export class PlatformMenuItem extends Model<
  InferAttributes<PlatformMenuItem>,
  InferCreationAttributes<PlatformMenuItem>
> {
  declare id: number;
  declare code: string;
  declare label: string;
  declare enabled: boolean;
  declare sortOrder: number;
  declare featureFlag: string | null;
  declare platformScope: string | null;
  declare roleScope: string | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformMenuItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    featureFlag: { type: DataTypes.STRING(64), allowNull: true, field: "feature_flag" },
    platformScope: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: "ALL",
      field: "platform_scope"
    },
    roleScope: { type: DataTypes.STRING(64), allowNull: true, field: "role_scope" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_menu_items", timestamps: true }
);

export class PlatformAd extends Model<
  InferAttributes<PlatformAd>,
  InferCreationAttributes<PlatformAd>
> {
  declare id: number;
  declare kind: string;
  declare title: string;
  declare imageUrl: string | null;
  declare targetScreen: string | null;
  declare priority: number;
  declare startsAt: Date | null;
  declare endsAt: Date | null;
  declare clickAction: string | null;
  declare isActive: boolean;
  declare views: number;
  declare clicks: number;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PlatformAd.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.ENUM(...AD_KINDS), allowNull: false, defaultValue: "BANNER" },
    title: { type: DataTypes.STRING(160), allowNull: false },
    imageUrl: { type: DataTypes.STRING(500), allowNull: true, field: "image_url" },
    targetScreen: { type: DataTypes.STRING(120), allowNull: true, field: "target_screen" },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    startsAt: { type: DataTypes.DATE, allowNull: true, field: "starts_at" },
    endsAt: { type: DataTypes.DATE, allowNull: true, field: "ends_at" },
    clickAction: { type: DataTypes.STRING(500), allowNull: true, field: "click_action" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    views: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    clicks: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "platform_ads", timestamps: true }
);

export class PlatformAuditLog extends Model<
  InferAttributes<PlatformAuditLog>,
  InferCreationAttributes<PlatformAuditLog>
> {
  declare id: number;
  declare adminEmail: string | null;
  declare action: string;
  declare module: string;
  declare detailsJson: Record<string, unknown> | null;
  declare createdAt: Date;
}

PlatformAuditLog.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    adminEmail: { type: DataTypes.STRING(191), allowNull: true, field: "admin_email" },
    action: { type: DataTypes.STRING(80), allowNull: false },
    module: { type: DataTypes.STRING(64), allowNull: false },
    detailsJson: { type: DataTypes.JSON, allowNull: true, field: "details_json" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "platform_audit_logs", timestamps: false }
);
