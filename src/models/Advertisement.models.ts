import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";
import type {
  AdvertisementEntitlementStatus,
  AdvertisementEventType,
  AdvertisementMediaKind,
  AdvertisementStatus
} from "../constants/advertisement.constants";

export type AdvertisementPricingSnapshot = {
  pricingId: number;
  pricingVersion: number;
  typeCode: string;
  durationDays: number;
  pricePaise: number;
  currency: string;
  refundOnReject: boolean;
};

export type AdvertisementTargeting = {
  audience: "ALL";
  gender?: string;
  ageMin?: number;
  ageMax?: number;
  district?: string;
  location?: string;
  userSegment?: string;
  subscriptionLevel?: string;
};

export class AdvertisementType extends Model<
  InferAttributes<AdvertisementType>,
  InferCreationAttributes<AdvertisementType>
> {
  declare id: CreationOptional<number>;
  declare code: string;
  declare label: string;
  declare mediaKind: AdvertisementMediaKind;
  declare isActive: CreationOptional<boolean>;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementType.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(80), allowNull: false },
    mediaKind: { type: DataTypes.STRING(16), allowNull: false, field: "media_kind" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    sortOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, field: "sort_order" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisement_types", timestamps: false }
);

export class AdvertisementPricing extends Model<
  InferAttributes<AdvertisementPricing>,
  InferCreationAttributes<AdvertisementPricing>
> {
  declare id: CreationOptional<number>;
  declare typeCode: string;
  declare durationDays: number;
  declare pricePaise: number;
  declare currency: string;
  declare isActive: CreationOptional<boolean>;
  declare refundOnReject: CreationOptional<boolean>;
  declare version: CreationOptional<number>;
  declare effectiveFrom: Date;
  declare effectiveTo: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementPricing.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    typeCode: { type: DataTypes.STRING(32), allowNull: false, field: "type_code" },
    durationDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "duration_days" },
    pricePaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "price_paise" },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    refundOnReject: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "refund_on_reject"
    },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    effectiveFrom: { type: DataTypes.DATE, allowNull: false, field: "effective_from" },
    effectiveTo: { type: DataTypes.DATE, allowNull: true, field: "effective_to" },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisement_pricing", timestamps: false }
);

export class Advertisement extends Model<InferAttributes<Advertisement>, InferCreationAttributes<Advertisement>> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare billingMode: CreationOptional<"paid" | "complimentary">;
  declare typeCode: string;
  declare businessName: string | null;
  declare businessCategory: string | null;
  declare title: string;
  declare shortDescription: string | null;
  declare description: string;
  declare ctaLabel: string;
  declare contactPhone: string | null;
  declare whatsappNumber: string | null;
  declare contactEmail: string | null;
  declare websiteUrl: string | null;
  declare address: string | null;
  declare city: string | null;
  declare district: string | null;
  declare state: string | null;
  declare pincode: string | null;
  declare latitude: number | null;
  declare longitude: number | null;
  declare ctaType: string | null;
  declare destinationUrl: string | null;
  declare mediaFileId: number | null;
  declare mediaUrl: string | null;
  declare thumbnailUrl: string | null;
  declare mediaKind: AdvertisementMediaKind | null;
  declare placementsJson: string[];
  declare targetingJson: AdvertisementTargeting;
  declare status: AdvertisementStatus;
  declare pricingId: number | null;
  declare pricingSnapshot: AdvertisementPricingSnapshot | null;
  declare durationDays: number | null;
  declare paymentOrderId: number | null;
  declare purchasedAt: Date | null;
  declare approvedAt: Date | null;
  declare rejectedAt: Date | null;
  declare rejectionReason: string | null;
  declare scheduledStartAt: Date | null;
  declare actualStartAt: Date | null;
  declare scheduledEndAt: Date | null;
  declare actualEndAt: Date | null;
  declare expiredAt: Date | null;
  declare pausedAt: Date | null;
  declare lastDeliveredAt: Date | null;
  declare impressionsCount: CreationOptional<number>;
  declare uniqueReachCount: CreationOptional<number>;
  declare clicksCount: CreationOptional<number>;
  declare reportsCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Advertisement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    billingMode: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "paid",
      field: "billing_mode"
    },
    typeCode: { type: DataTypes.STRING(32), allowNull: false, field: "type_code" },
    businessName: { type: DataTypes.STRING(120), allowNull: true, field: "business_name" },
    businessCategory: { type: DataTypes.STRING(80), allowNull: true, field: "business_category" },
    title: { type: DataTypes.STRING(80), allowNull: false },
    shortDescription: { type: DataTypes.STRING(280), allowNull: true, field: "short_description" },
    description: { type: DataTypes.TEXT, allowNull: false },
    ctaLabel: { type: DataTypes.STRING(40), allowNull: false, field: "cta_label" },
    contactPhone: { type: DataTypes.STRING(20), allowNull: true, field: "contact_phone" },
    whatsappNumber: { type: DataTypes.STRING(20), allowNull: true, field: "whatsapp_number" },
    contactEmail: { type: DataTypes.STRING(191), allowNull: true, field: "contact_email" },
    websiteUrl: { type: DataTypes.STRING(2048), allowNull: true, field: "website_url" },
    address: { type: DataTypes.STRING(255), allowNull: true },
    city: { type: DataTypes.STRING(80), allowNull: true },
    district: { type: DataTypes.STRING(80), allowNull: true },
    state: { type: DataTypes.STRING(80), allowNull: true },
    pincode: { type: DataTypes.STRING(10), allowNull: true },
    latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    ctaType: { type: DataTypes.STRING(24), allowNull: true, field: "cta_type" },
    destinationUrl: { type: DataTypes.STRING(2048), allowNull: true, field: "destination_url" },
    mediaFileId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "media_file_id" },
    mediaUrl: { type: DataTypes.STRING(500), allowNull: true, field: "media_url" },
    thumbnailUrl: { type: DataTypes.STRING(500), allowNull: true, field: "thumbnail_url" },
    mediaKind: { type: DataTypes.STRING(16), allowNull: true, field: "media_kind" },
    placementsJson: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: ["home"],
      field: "placements_json"
    },
    targetingJson: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: { audience: "ALL" },
      field: "targeting_json"
    },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "DRAFT" },
    pricingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "pricing_id" },
    pricingSnapshot: { type: DataTypes.JSON, allowNull: true, field: "pricing_snapshot" },
    durationDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "duration_days" },
    paymentOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "payment_order_id" },
    purchasedAt: { type: DataTypes.DATE, allowNull: true, field: "purchased_at" },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
    rejectedAt: { type: DataTypes.DATE, allowNull: true, field: "rejected_at" },
    rejectionReason: { type: DataTypes.STRING(500), allowNull: true, field: "rejection_reason" },
    scheduledStartAt: { type: DataTypes.DATE, allowNull: true, field: "scheduled_start_at" },
    actualStartAt: { type: DataTypes.DATE, allowNull: true, field: "actual_start_at" },
    scheduledEndAt: { type: DataTypes.DATE, allowNull: true, field: "scheduled_end_at" },
    actualEndAt: { type: DataTypes.DATE, allowNull: true, field: "actual_end_at" },
    expiredAt: { type: DataTypes.DATE, allowNull: true, field: "expired_at" },
    pausedAt: { type: DataTypes.DATE, allowNull: true, field: "paused_at" },
    lastDeliveredAt: { type: DataTypes.DATE, allowNull: true, field: "last_delivered_at" },
    impressionsCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "impressions_count"
    },
    uniqueReachCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "unique_reach_count"
    },
    clicksCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "clicks_count"
    },
    reportsCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "reports_count"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisements", timestamps: false }
);

export class AdvertisementEntitlement extends Model<
  InferAttributes<AdvertisementEntitlement>,
  InferCreationAttributes<AdvertisementEntitlement>
> {
  declare id: CreationOptional<number>;
  declare advertisementId: number;
  declare userId: number;
  declare paymentOrderId: number;
  declare product: string;
  declare durationDays: number;
  declare amountPaise: number;
  declare currency: string;
  declare status: AdvertisementEntitlementStatus;
  declare startsAt: Date | null;
  declare endsAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementEntitlement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    advertisementId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      field: "advertisement_id"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    paymentOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "payment_order_id" },
    product: { type: DataTypes.STRING(64), allowNull: false },
    durationDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "duration_days" },
    amountPaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "amount_paise" },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "PENDING" },
    startsAt: { type: DataTypes.DATE, allowNull: true, field: "starts_at" },
    endsAt: { type: DataTypes.DATE, allowNull: true, field: "ends_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisement_entitlements", timestamps: false }
);

export class AdvertisementModerationLog extends Model<
  InferAttributes<AdvertisementModerationLog>,
  InferCreationAttributes<AdvertisementModerationLog>
> {
  declare id: CreationOptional<number>;
  declare advertisementId: number;
  declare actor: string;
  declare action: string;
  declare fromStatus: string | null;
  declare toStatus: string | null;
  declare reason: string | null;
  declare createdAt: CreationOptional<Date>;
}

AdvertisementModerationLog.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    advertisementId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "advertisement_id" },
    actor: { type: DataTypes.STRING(191), allowNull: false },
    action: { type: DataTypes.STRING(64), allowNull: false },
    fromStatus: { type: DataTypes.STRING(24), allowNull: true, field: "from_status" },
    toStatus: { type: DataTypes.STRING(24), allowNull: true, field: "to_status" },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "advertisement_moderation_logs", timestamps: false }
);

export class AdvertisementExtension extends Model<
  InferAttributes<AdvertisementExtension>,
  InferCreationAttributes<AdvertisementExtension>
> {
  declare id: CreationOptional<number>;
  declare advertisementId: number;
  declare oldEndAt: Date;
  declare newEndAt: Date;
  declare extensionDays: number;
  declare adminEmail: string;
  declare reason: string | null;
  declare createdAt: CreationOptional<Date>;
}

AdvertisementExtension.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    advertisementId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "advertisement_id" },
    oldEndAt: { type: DataTypes.DATE, allowNull: false, field: "old_end_at" },
    newEndAt: { type: DataTypes.DATE, allowNull: false, field: "new_end_at" },
    extensionDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "extension_days" },
    adminEmail: { type: DataTypes.STRING(191), allowNull: false, field: "admin_email" },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "advertisement_extensions", timestamps: false }
);

export class AdvertisementEvent extends Model<
  InferAttributes<AdvertisementEvent>,
  InferCreationAttributes<AdvertisementEvent>
> {
  declare id: CreationOptional<number>;
  declare eventId: string | null;
  declare advertisementId: number;
  declare userId: number | null;
  declare eventType: AdvertisementEventType;
  declare action: string | null;
  declare placement: string;
  declare platform: string | null;
  declare createdAt: CreationOptional<Date>;
}

AdvertisementEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    eventId: { type: DataTypes.STRING(64), allowNull: true, unique: true, field: "event_id" },
    advertisementId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "advertisement_id" },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "user_id" },
    eventType: { type: DataTypes.STRING(16), allowNull: false, field: "event_type" },
    action: { type: DataTypes.STRING(32), allowNull: true },
    placement: { type: DataTypes.STRING(32), allowNull: false },
    platform: { type: DataTypes.STRING(16), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "advertisement_events", timestamps: false }
);

export class AdvertisementUniqueReach extends Model<
  InferAttributes<AdvertisementUniqueReach>,
  InferCreationAttributes<AdvertisementUniqueReach>
> {
  declare advertisementId: number;
  declare userId: number;
  declare firstSeenAt: Date;
}

AdvertisementUniqueReach.init(
  {
    advertisementId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      field: "advertisement_id"
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      field: "user_id"
    },
    firstSeenAt: { type: DataTypes.DATE, allowNull: false, field: "first_seen_at" }
  },
  { sequelize, tableName: "advertisement_unique_reach", timestamps: false }
);

export class AdvertisementDailyStat extends Model<
  InferAttributes<AdvertisementDailyStat>,
  InferCreationAttributes<AdvertisementDailyStat>
> {
  declare id: CreationOptional<number>;
  declare advertisementId: number;
  declare statDate: string;
  declare impressions: CreationOptional<number>;
  declare uniqueViewers: CreationOptional<number>;
  declare clicks: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementDailyStat.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    advertisementId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "advertisement_id" },
    statDate: { type: DataTypes.DATEONLY, allowNull: false, field: "stat_date" },
    impressions: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    uniqueViewers: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "unique_viewers"
    },
    clicks: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisement_daily_stats", timestamps: false }
);

export class AdvertisementUserExposure extends Model<
  InferAttributes<AdvertisementUserExposure>,
  InferCreationAttributes<AdvertisementUserExposure>
> {
  declare userId: number;
  declare advertisementId: number;
  declare lastImpressionAt: Date | null;
  declare impressionCount: CreationOptional<number>;
  declare lastClickAt: Date | null;
  declare clickCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementUserExposure.init(
  {
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true, field: "user_id" },
    advertisementId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      field: "advertisement_id"
    },
    lastImpressionAt: { type: DataTypes.DATE, allowNull: true, field: "last_impression_at" },
    impressionCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "impression_count"
    },
    lastClickAt: { type: DataTypes.DATE, allowNull: true, field: "last_click_at" },
    clickCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, field: "click_count" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "advertisement_user_exposures", timestamps: false }
);

export class AdvertisementReport extends Model<
  InferAttributes<AdvertisementReport>,
  InferCreationAttributes<AdvertisementReport>
> {
  declare id: CreationOptional<number>;
  declare advertisementId: number;
  declare reporterUserId: number;
  declare reason: string;
  declare details: string | null;
  declare status: string;
  declare reviewedAt: Date | null;
  declare reviewedBy: string | null;
  declare reviewNotes: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdvertisementReport.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    advertisementId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "advertisement_id" },
    reporterUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "reporter_user_id" },
    reason: { type: DataTypes.STRING(32), allowNull: false },
    details: { type: DataTypes.STRING(500), allowNull: true },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "PENDING" },
    reviewedAt: { type: DataTypes.DATE, allowNull: true, field: "reviewed_at" },
    reviewedBy: { type: DataTypes.STRING(191), allowNull: true, field: "reviewed_by" },
    reviewNotes: { type: DataTypes.STRING(500), allowNull: true, field: "review_notes" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "advertisement_reports",
    timestamps: false,
    indexes: [
      {
        unique: true,
        name: "uq_ad_reports_ad_reporter",
        fields: ["advertisement_id", "reporter_user_id"]
      }
    ]
  }
);
