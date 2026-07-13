import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const HELP_OFFER_STATUSES = ["ACTIVE", "WITHDRAWN"] as const;
export type HelpOfferStatus = (typeof HELP_OFFER_STATUSES)[number];

export class HelpOffer extends Model<InferAttributes<HelpOffer>, InferCreationAttributes<HelpOffer>> {
  declare id: number;
  declare postId: number;
  declare fromUserId: number;
  declare status: HelpOfferStatus;
  declare message: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

HelpOffer.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    fromUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "ACTIVE"
    },
    message: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "help_offers",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["postId", "fromUserId"], name: "uq_help_offer_post_user" },
      { fields: ["postId"], name: "idx_help_offers_post" },
      { fields: ["fromUserId"], name: "idx_help_offers_from" }
    ]
  }
);
