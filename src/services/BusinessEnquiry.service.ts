/**
 * Business enquiry — reuses existing 1:1 messages without requiring a Connection.
 * Permission is granted via the "business" chat lane in MessagePermission.service.
 */

import { Op } from "sequelize";
import { Message, User, UserProfile } from "../models";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import { toPublicBusinessProfile } from "./Profile.service";
import { emitMessageEvents } from "../realtime/messageEvents";
import {
  NOTIFICATION_ACTIONS,
  NOTIFICATION_TYPES
} from "../constants/notification.constants";
import * as NotificationPlatform from "./NotificationPlatform.service";

export const BUSINESS_ENQUIRY_TYPES = [
  "PRODUCT_SERVICE",
  "PRICE",
  "AVAILABILITY",
  "PARTNERSHIP",
  "WHOLESALE",
  "OTHER"
] as const;

export type BusinessEnquiryType = (typeof BUSINESS_ENQUIRY_TYPES)[number];

export const BUSINESS_ENQUIRY_TYPE_LABELS: Record<BusinessEnquiryType, string> = {
  PRODUCT_SERVICE: "Product / Service",
  PRICE: "Price Enquiry",
  AVAILABILITY: "Availability",
  PARTNERSHIP: "Partnership",
  WHOLESALE: "Wholesale",
  OTHER: "Other"
};

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
/** Soft duplicate guard for double-tap / retry */
const DUPLICATE_WINDOW_MS = 45_000;

function httpErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export function formatBusinessEnquiryBody(input: {
  businessName: string;
  enquiryType: BusinessEnquiryType;
  message: string;
}): string {
  const typeLabel = BUSINESS_ENQUIRY_TYPE_LABELS[input.enquiryType];
  return [
    "Business Enquiry",
    `Business: ${input.businessName}`,
    `Type: ${typeLabel}`,
    "",
    input.message.trim()
  ].join("\n");
}

export async function submitBusinessEnquiry(input: {
  senderId: number;
  businessOwnerId: number;
  enquiryType: string;
  message: string;
  clientId?: string | null;
}): Promise<{
  messageId: number;
  otherUserId: number;
  body: string;
  createdAt: string;
}> {
  const senderId = Number(input.senderId);
  const businessOwnerId = Number(input.businessOwnerId);

  if (!Number.isFinite(senderId) || senderId < 1) {
    throw httpErr("Unauthorized", 401, "UNAUTHORIZED");
  }
  if (!Number.isFinite(businessOwnerId) || businessOwnerId < 1) {
    throw httpErr("Invalid business owner.", 400, "INVALID_OWNER");
  }
  if (senderId === businessOwnerId) {
    throw httpErr("You cannot send an enquiry to your own business.", 400, "SELF_ENQUIRY");
  }

  const enquiryType = String(input.enquiryType || "").trim().toUpperCase();
  if (!(BUSINESS_ENQUIRY_TYPES as readonly string[]).includes(enquiryType)) {
    throw httpErr("Please select what you are looking for.", 400, "INVALID_ENQUIRY_TYPE");
  }

  const message = String(input.message || "").trim();
  if (message.length < MESSAGE_MIN) {
    throw httpErr(`Message must be at least ${MESSAGE_MIN} characters.`, 400, "MESSAGE_TOO_SHORT");
  }
  if (message.length > MESSAGE_MAX) {
    throw httpErr(`Message must be at most ${MESSAGE_MAX} characters.`, 400, "MESSAGE_TOO_LONG");
  }

  const [sender, owner] = await Promise.all([
    User.findByPk(senderId, { attributes: ["id", "status", "fullName"] }),
    User.findByPk(businessOwnerId, { attributes: ["id", "status", "fullName"] })
  ]);

  if (!sender || sender.status !== "APPROVED") {
    throw httpErr("Unauthorized", 401, "UNAUTHORIZED");
  }
  if (!owner || owner.status !== "APPROVED") {
    throw httpErr("This Business Profile is currently unavailable.", 404, "BUSINESS_UNAVAILABLE");
  }

  const blocked = await getBlockedUserIds(senderId);
  if (blocked.has(businessOwnerId)) {
    throw httpErr("You cannot contact this business.", 403, "BLOCKED");
  }
  const blockedByOwner = await getBlockedUserIds(businessOwnerId);
  if (blockedByOwner.has(senderId)) {
    throw httpErr("You cannot contact this business.", 403, "BLOCKED");
  }

  const profile = await UserProfile.findOne({
    where: { userId: businessOwnerId },
    attributes: ["business"]
  });
  const publicBusiness = toPublicBusinessProfile(profile?.business ?? null);
  if (!publicBusiness) {
    throw httpErr("This Business Profile is currently unavailable.", 400, "BUSINESS_UNAVAILABLE");
  }

  const businessName = publicBusiness.businessName || owner.fullName || "Business";
  const body = formatBusinessEnquiryBody({
    businessName,
    enquiryType: enquiryType as BusinessEnquiryType,
    message
  });

  const clientId = input.clientId?.trim() || null;
  if (clientId) {
    const existingByClient = await Message.findOne({
      where: { senderId, recipientId: businessOwnerId, clientId },
      order: [["id", "DESC"]]
    });
    if (existingByClient) {
      return {
        messageId: existingByClient.id,
        otherUserId: businessOwnerId,
        body: existingByClient.body,
        createdAt: existingByClient.createdAt.toISOString()
      };
    }
  }

  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const recentDup = await Message.findOne({
    where: {
      senderId,
      recipientId: businessOwnerId,
      body,
      createdAt: { [Op.gte]: since }
    },
    order: [["id", "DESC"]]
  });
  if (recentDup) {
    return {
      messageId: recentDup.id,
      otherUserId: businessOwnerId,
      body: recentDup.body,
      createdAt: recentDup.createdAt.toISOString()
    };
  }

  const msg = await Message.create({
    senderId,
    recipientId: businessOwnerId,
    body,
    clientId,
    deliveredAt: null,
    readAt: null
  } as any);

  const dto = {
    id: msg.id,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    body: msg.body,
    sharedPostId: null,
    clientId: msg.clientId,
    deliveredAt: null,
    readAt: null,
    createdAt: msg.createdAt.toISOString()
  };
  emitMessageEvents(dto);

  // Dedicated in-app + push notification (skip MESSAGE_NEW to avoid duplicates).
  await NotificationPlatform.dispatchNotification({
    userId: businessOwnerId,
    type: NOTIFICATION_TYPES.BUSINESS_ENQUIRY_RECEIVED,
    title: "New Business Enquiry",
    body: "You received a new enquiry about your business.",
    actorUserId: senderId,
    actionType: NOTIFICATION_ACTIONS.OPEN_CHAT,
    actionTargetId: senderId,
    groupKey: `business_enquiry:${businessOwnerId}:${senderId}`,
    metadata: {
      enquiryType,
      businessOwnerId,
      kind: "BUSINESS_ENQUIRY",
      businessName
    }
  });

  return {
    messageId: msg.id,
    otherUserId: businessOwnerId,
    body: msg.body,
    createdAt: msg.createdAt.toISOString()
  };
}
