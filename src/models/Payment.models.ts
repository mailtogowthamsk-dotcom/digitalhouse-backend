import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";
import type { PaymentModule, PaymentOrderStatus, PaymentRefundStatus } from "../constants/payment.constants";

export type PaymentOrderMeta = {
  advertisementId?: number;
  pricingId?: number;
  pricingVersion?: number;
  typeCode?: string;
  durationDays?: number;
  title?: string;
  gstPercent?: number;
  gstAmountPaise?: number;
  amountBeforeGstPaise?: number;
  /** Captured after another order for the same reference was already fulfilled. Refundable. */
  duplicateCapture?: boolean;
  primaryOrderId?: number;
  [key: string]: unknown;
};

export class PaymentOrder extends Model<InferAttributes<PaymentOrder>, InferCreationAttributes<PaymentOrder>> {
  declare id: CreationOptional<number>;
  declare module: PaymentModule;
  declare userId: number;
  declare referenceId: number;
  declare product: string;
  declare amountPaise: number;
  declare currency: string;
  declare description: string;
  declare razorpayOrderId: string;
  declare razorpayPaymentId: string | null;
  declare status: PaymentOrderStatus;
  declare meta: PaymentOrderMeta | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PaymentOrder.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    module: { type: DataTypes.STRING(32), allowNull: false },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    referenceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "reference_id" },
    product: { type: DataTypes.STRING(64), allowNull: false },
    amountPaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "amount_paise" },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    description: { type: DataTypes.STRING(255), allowNull: false },
    razorpayOrderId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: "razorpay_order_id"
    },
    razorpayPaymentId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "razorpay_payment_id"
    },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "CREATED" },
    meta: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "payment_orders", timestamps: false }
);

export class PaymentInvoice extends Model<
  InferAttributes<PaymentInvoice>,
  InferCreationAttributes<PaymentInvoice>
> {
  declare id: CreationOptional<number>;
  declare paymentOrderId: number;
  declare invoiceNumber: string;
  declare userId: number;
  declare module: string;
  declare referenceId: number;
  declare description: string;
  declare amountPaise: number;
  declare gstPercent: number;
  declare gstAmountPaise: number;
  declare amountBeforeGstPaise: number;
  declare currency: string;
  declare issuedAt: Date;
  declare createdAt: CreationOptional<Date>;
}

PaymentInvoice.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    paymentOrderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      field: "payment_order_id"
    },
    invoiceNumber: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      field: "invoice_number"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    module: { type: DataTypes.STRING(32), allowNull: false },
    referenceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "reference_id" },
    description: { type: DataTypes.STRING(255), allowNull: false },
    amountPaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "amount_paise" },
    gstPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0, field: "gst_percent" },
    gstAmountPaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "gst_amount_paise"
    },
    amountBeforeGstPaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "amount_before_gst_paise"
    },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    issuedAt: { type: DataTypes.DATE, allowNull: false, field: "issued_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "payment_invoices", timestamps: false }
);

export class PaymentRefund extends Model<
  InferAttributes<PaymentRefund>,
  InferCreationAttributes<PaymentRefund>
> {
  declare id: CreationOptional<number>;
  declare paymentOrderId: number;
  declare userId: number;
  declare amountPaise: number;
  declare currency: string;
  declare status: PaymentRefundStatus;
  declare reason: string | null;
  declare razorpayRefundId: string | null;
  declare processedBy: string | null;
  declare processedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PaymentRefund.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    paymentOrderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "payment_order_id"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    amountPaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "amount_paise" },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "PENDING" },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    razorpayRefundId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true,
      field: "razorpay_refund_id"
    },
    processedBy: { type: DataTypes.STRING(191), allowNull: true, field: "processed_by" },
    processedAt: { type: DataTypes.DATE, allowNull: true, field: "processed_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "payment_refunds", timestamps: false }
);
