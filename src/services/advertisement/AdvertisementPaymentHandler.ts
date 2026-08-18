import type { PaymentOrder } from "../../models/Payment.models";
import type { AdvertisementPricingSnapshot } from "../../models/Advertisement.models";
import { AdvertisementEntitlement } from "../../models/Advertisement.models";
import * as Payment from "../payments/Payment.service";
import * as Refund from "../payments/Refund.service";
import * as Ads from "./Advertisement.service";
import * as Notifications from "../Notification.service";

function snapshotFromOrder(order: PaymentOrder): AdvertisementPricingSnapshot {
  const meta = order.meta ?? {};
  return {
    pricingId: Number(meta.pricingId),
    pricingVersion: Number(meta.pricingVersion ?? 1),
    typeCode: String(meta.typeCode || ""),
    durationDays: Number(meta.durationDays),
    pricePaise: order.amountPaise,
    currency: order.currency,
    refundOnReject: Boolean(meta.refundOnReject)
  };
}

export function registerAdvertisementPaymentHandlers(): void {
  Payment.registerPaymentFulfillmentHandler("advertisement", async ({ order, transaction }) => {
    await Ads.fulfillPaidAdvertisement(
      order.referenceId,
      order.id,
      order.amountPaise,
      snapshotFromOrder(order),
      transaction
    );
  });

  Payment.registerPaymentFailureHandler("advertisement", async ({ order }) => {
    await Ads.revertPaymentFailure(order.referenceId);
    void Notifications.notifyAdvertisementPaymentFailed(order.userId, order.referenceId).catch(
      () => {}
    );
  });

  Refund.registerPaymentRefundHandler("advertisement", async ({ order, transaction }) => {
    if (Payment.isDuplicateCapture(order)) return;
    const entitlement = await AdvertisementEntitlement.findOne({
      where: { advertisementId: order.referenceId },
      transaction
    });
    if (entitlement) {
      await entitlement.update(
        { status: "REFUNDED", updatedAt: new Date() },
        { transaction }
      );
    }
  });
}

export async function notifyPaymentSuccessAfterCommit(order: PaymentOrder): Promise<void> {
  await Notifications.notifyAdvertisementPaymentSuccess(
    order.userId,
    order.referenceId,
    order.amountPaise / 100
  );
  await Notifications.notifyAdvertisementSubmittedForReview(order.userId, order.referenceId);
  void Notifications.notifyAdvertisementInvoiceAvailable(order.userId, order.referenceId).catch(
    () => {}
  );
}
