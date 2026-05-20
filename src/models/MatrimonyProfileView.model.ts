import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MatrimonyProfileView extends Model<
  InferAttributes<MatrimonyProfileView>,
  InferCreationAttributes<MatrimonyProfileView>
> {
  declare id: number;
  declare viewerId: number;
  declare viewedUserId: number;
  declare createdAt: Date;
}

MatrimonyProfileView.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    viewerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "viewer_id" },
    viewedUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "viewed_user_id" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "matrimony_profile_views", timestamps: false }
);
