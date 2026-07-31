/**
 * Admin User Management — enriched detail, edit, soft delete, hard delete (+ R2 cleanup).
 */
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../config/db";
import {
  User,
  UserProfile,
  PendingProfileUpdate,
  AdminVerification,
  Post,
  PostLike,
  Comment,
  SavedPost,
  PostReport,
  PostHashtag,
  FeedEngagementEvent,
  MediaFile,
  Notification,
  NotificationPreference,
  PushDeviceToken,
  Message,
  MessageThreadPreference,
  Otp,
  UsernameReservation,
  AuthAnalyticsEvent,
  ModerationAction,
  MemberConnection,
  MemberProfessionalIdentity,
  MemberExpertiseSelection,
  JobInterest,
  HelpOffer,
  HelpAppreciation,
  MatrimonyRequestMeta,
  MatrimonyAdminNote,
  MatrimonyReviewAudit,
  MatrimonyInterest,
  MatrimonyMatch,
  MatrimonySavedProfile,
  MatrimonyBlock,
  MatrimonyReport,
  MatrimonySubscription,
  MatrimonyProfileOpen,
  MatrimonyContactReveal,
  MatrimonyProfileView,
  MatrimonyPaymentOrder,
  SupportTicket,
  SupportTicketMessage,
  PlatformPopupAck
} from "../models";
import type { MatrimonySection } from "../models/UserProfile.model";
import { userService } from "./user.service";
import { registrationStatusService } from "./RegistrationStatus.service";
import {
  toPublicUrlIfR2,
  toPrivateSignedUrlIfR2,
  deleteR2ImageVariants
} from "../utils/r2Client";
import { resolveLoginSource } from "../utils/authProvider.util";

function ageFromDob(dob: Date | string | null | undefined): number | null {
  if (!dob) return null;
  const d = typeof dob === "string" ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

function collectUrl(set: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) set.add(value.trim());
}

function collectMatrimonyUrls(set: Set<string>, matrimony: MatrimonySection | null | undefined) {
  if (!matrimony) return;
  collectUrl(set, matrimony.candidatePhotoUrl);
  collectUrl(set, matrimony.profilePhotoUrl);
  collectUrl(set, matrimony.horoscopeDocumentUrl);
  if (Array.isArray(matrimony.candidatePhotos)) {
    for (const p of matrimony.candidatePhotos) collectUrl(set, p?.url);
  }
}

function collectPendingDataUrls(set: Set<string>, data: unknown) {
  if (!data || typeof data !== "object") return;
  const rec = data as Record<string, unknown>;
  for (const key of ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"]) {
    collectUrl(set, rec[key]);
  }
  if (Array.isArray(rec.candidatePhotos)) {
    for (const p of rec.candidatePhotos as Array<{ url?: string }>) collectUrl(set, p?.url);
  }
}

async function deleteR2Urls(urls: Set<string>): Promise<number> {
  let deleted = 0;
  await Promise.all(
    [...urls].map(async (url) => {
      await deleteR2ImageVariants(url);
      deleted += 1;
    })
  );
  return deleted;
}

function remainingDays(endsAt: Date | null | undefined): number | null {
  if (!endsAt) return null;
  const ms = endsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export type AdminUserUpdateInput = {
  fullName?: string;
  username?: string | null;
  gender?: string | null;
  dob?: string | null;
  email?: string;
  mobile?: string | null;
  occupation?: string | null;
  location?: string | null;
  community?: string | null;
  kulam?: string | null;
  bloodGroup?: string | null;
  education?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  workLocation?: string | null;
  skills?: string | null;
  city?: string | null;
  district?: string | null;
  communityRole?: string | null;
  profileVisibility?: "PUBLIC" | "PRIVATE";
  allowConnectionRequests?: boolean;
};

/** Enriched admin user detail — single composed payload (no N+1). */
export async function getAdminUserDetail(userId: number) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const [
    profile,
    notificationPrefs,
    devices,
    verificationHistory,
    subscription,
    paymentOrders,
    moderationActions,
    authEvents,
    pendingUpdates
  ] = await Promise.all([
    UserProfile.findOne({ where: { userId } }),
    NotificationPreference.findByPk(userId),
    PushDeviceToken.findAll({
      where: { userId },
      order: [["lastUsedAt", "DESC"]],
      limit: 50
    }),
    AdminVerification.findAll({
      where: { userId },
      order: [["verifiedAt", "DESC"]],
      limit: 50
    }),
    MatrimonySubscription.findOne({
      where: { userId },
      order: [["createdAt", "DESC"]]
    }),
    MatrimonyPaymentOrder.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: 20
    }),
    ModerationAction.findAll({
      where: { targetUserId: userId },
      order: [["createdAt", "DESC"]],
      limit: 50
    }),
    AuthAnalyticsEvent.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: 30
    }),
    PendingProfileUpdate.findAll({
      where: { userId },
      order: [["submittedAt", "DESC"]],
      limit: 20
    })
  ]);

  const [
    totalPosts,
    imagesUploaded,
    videosUploaded,
    marketplaceListings,
    marketplaceSold,
    marketplacePending,
    marketplaceRejected,
    commentsCount,
    likesGiven,
    likesReceivedRow,
    connectionsAccepted,
    reportsReceivedPosts,
    reportsSubmittedPosts,
    reportsReceivedMatrimony,
    reportsSubmittedMatrimony,
    blockedByUser,
    interestSent,
    interestReceived,
    matchesCount,
    savedProfiles,
    storageRows,
    followersApprox,
    followingApprox
  ] = await Promise.all([
    Post.count({ where: { userId } }),
    MediaFile.count({ where: { userId, fileType: "image" } }),
    MediaFile.count({ where: { userId, fileType: "video" } }),
    Post.count({ where: { userId, postType: "MARKETPLACE" } }),
    Post.count({ where: { userId, postType: "MARKETPLACE", marketplaceStatus: "SOLD" } }),
    Post.count({
      where: { userId, postType: "MARKETPLACE", marketplaceStatus: "PENDING_REVIEW" }
    }),
    Post.count({ where: { userId, postType: "MARKETPLACE", marketplaceStatus: "REJECTED" } }),
    Comment.count({ where: { userId } }),
    PostLike.count({ where: { userId } }),
    sequelize.query<{ total: number }>(
      `SELECT COALESCE(SUM(p.likeCount), 0) AS total FROM posts p WHERE p.userId = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    ),
    MemberConnection.count({
      where: {
        status: "ACCEPTED",
        [Op.or]: [{ requesterUserId: userId }, { recipientUserId: userId }]
      }
    }),
    sequelize
      .query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM post_reports pr
         INNER JOIN posts p ON p.id = pr.postId WHERE p.userId = :userId`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      )
      .then((rows) => Number(rows?.[0]?.total ?? 0))
      .catch(() => 0),
    PostReport.count({ where: { reporterId: userId } }),
    MatrimonyReport.count({ where: { reportedUserId: userId } }),
    MatrimonyReport.count({ where: { reporterId: userId } }),
    MatrimonyBlock.count({ where: { userId } }),
    MatrimonyInterest.count({ where: { fromUserId: userId } }),
    MatrimonyInterest.count({ where: { toUserId: userId } }),
    MatrimonyMatch.count({
      where: { [Op.or]: [{ userLowId: userId }, { userHighId: userId }] }
    }),
    MatrimonySavedProfile.count({ where: { userId } }),
    sequelize.query<{ module: string; fileType: string; bytes: number; files: number }>(
      `SELECT module, fileType,
              COALESCE(SUM(byteSize), 0) AS bytes,
              COUNT(*) AS files
       FROM media_files
       WHERE userId = :userId
       GROUP BY module, fileType`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    ),
    MemberConnection.count({
      where: { status: "ACCEPTED", recipientUserId: userId }
    }),
    MemberConnection.count({
      where: { status: "ACCEPTED", requesterUserId: userId }
    })
  ]);

  const likesReceived = Number(likesReceivedRow?.[0]?.total ?? 0);
  const totalStorageBytes = storageRows.reduce((sum, r) => sum + Number(r.bytes || 0), 0);

  const profilePhotoSigned = user.profilePhoto
    ? toPublicUrlIfR2(user.profilePhoto) ?? user.profilePhoto
    : null;
  const pendingPhotoSigned = user.pendingProfilePhoto
    ? toPublicUrlIfR2(user.pendingProfilePhoto) ?? user.pendingProfilePhoto
    : null;
  const govtIdSigned = await toPrivateSignedUrlIfR2(user.govtIdFile);

  let matrimonySigned = profile?.matrimony ?? null;
  if (matrimonySigned) {
    const m = { ...matrimonySigned };
    if (m.candidatePhotoUrl) {
      m.candidatePhotoUrl = toPublicUrlIfR2(m.candidatePhotoUrl) ?? m.candidatePhotoUrl;
    }
    if (m.horoscopeDocumentUrl) {
      m.horoscopeDocumentUrl = await toPrivateSignedUrlIfR2(m.horoscopeDocumentUrl);
    }
    if (Array.isArray(m.candidatePhotos)) {
      m.candidatePhotos = await Promise.all(
        m.candidatePhotos.map(async (p) => ({
          ...p,
          url: p.url ? (toPublicUrlIfR2(p.url) ?? p.url) : p.url
        }))
      );
    }
    matrimonySigned = m;
  }

  const registrationReview = await registrationStatusService.toAdminRegistrationReview(user);

  const lastDevice = devices[0] ?? null;
  const loginEventCount = await AuthAnalyticsEvent.count({
    where: {
      userId,
      eventType: { [Op.in]: ["GOOGLE_LOGIN", "EXISTING_LOGIN"] }
    }
  }).catch(() => authEvents.length);

  const totalPaidPaise = paymentOrders
    .filter((o) => String(o.status).toUpperCase() === "PAID" || String(o.status).toUpperCase() === "CAPTURED")
    .reduce((s, o) => s + (o.amountPaise || 0), 0);

  const timeline: Array<{ at: string; type: string; label: string; meta?: string | null }> = [];
  timeline.push({
    at: user.createdAt.toISOString(),
    type: "ACCOUNT_CREATED",
    label: "Account Created"
  });
  for (const v of verificationHistory) {
    timeline.push({
      at: v.verifiedAt.toISOString(),
      type: "VERIFICATION",
      label: `Registration action by ${v.verifiedBy}`,
      meta: v.remarks
    });
  }
  for (const a of moderationActions) {
    timeline.push({
      at: a.createdAt.toISOString(),
      type: a.action,
      label: `Moderation: ${a.action}`,
      meta: a.note
    });
  }
  for (const e of authEvents) {
    timeline.push({
      at: e.createdAt.toISOString(),
      type: e.eventType,
      label: `Auth: ${e.eventType}`,
      meta: e.provider
    });
  }
  for (const u of pendingUpdates) {
    timeline.push({
      at: (u.submittedAt || u.createdAt).toISOString(),
      type: "PROFILE_UPDATE",
      label: `${u.section} profile submitted (${u.status})`,
      meta: u.adminRemarks
    });
  }
  if (subscription) {
    timeline.push({
      at: subscription.createdAt.toISOString(),
      type: "SUBSCRIPTION",
      label: `Subscription ${subscription.plan} (${subscription.status})`
    });
  }
  if (user.deletedAt) {
    timeline.push({
      at: user.deletedAt.toISOString(),
      type: "SOFT_DELETED",
      label: "Account soft-deleted",
      meta: user.deleteReason
    });
  }
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const base = await userService.toAdminUser(user);

  return {
    user: {
      ...base,
      username: user.username,
      profileVisibility: user.profileVisibility,
      allowConnectionRequests: user.allowConnectionRequests,
      bloodGroup: user.bloodGroup,
      education: user.education,
      jobTitle: user.jobTitle,
      company: user.company,
      workLocation: user.workLocation,
      skills: user.skills,
      city: user.city,
      district: user.district,
      communityRole: user.communityRole,
      age: ageFromDob(user.dob),
      profilePhoto: profilePhotoSigned,
      pendingProfilePhoto: pendingPhotoSigned,
      govtIdFile: govtIdSigned,
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
      deletedBy: user.deletedBy,
      deleteReason: user.deleteReason
    },
    profile: {
      community: profile?.community ?? null,
      personal: profile?.personal ?? null,
      matrimony: matrimonySigned,
      business: profile?.business ?? null,
      family: profile?.family ?? null
    },
    registrationReview,
    verificationHistory: verificationHistory.map((v) => ({
      id: v.id,
      verifiedBy: v.verifiedBy,
      verifiedAt: v.verifiedAt.toISOString(),
      remarks: v.remarks
    })),
    activity: {
      lastLoginProvider: user.lastLoginProvider,
      accountCreated: user.createdAt.toISOString(),
      lastActive:
        (await import("../realtime/presence")
          .then(async ({ getLastSeenAt, isOnline }) =>
            (await isOnline(user.id))
              ? new Date().toISOString()
              : await getLastSeenAt(user.id)
          )
          .catch(() => null)) ??
        user.lastSeenAt?.toISOString() ??
        lastDevice?.lastUsedAt?.toISOString() ??
        user.updatedAt.toISOString(),
      numberOfLogins: loginEventCount,
      deviceCount: devices.length,
      onlineStatus: (await import("../realtime/presence")
        .then(async ({ isOnline }) => ((await isOnline(user.id)) ? "online" : "offline"))
        .catch(() => "unknown")) as "online" | "offline" | "unknown"
    },
    statistics: {
      totalPosts,
      imagesUploaded,
      videosUploaded,
      marketplaceListings,
      matrimonyProfileCreated: !!(profile?.matrimony?.matrimonyProfileActive),
      comments: commentsCount,
      likesGiven,
      likesReceived,
      followers: followersApprox,
      following: followingApprox,
      friends: connectionsAccepted,
      reportsReceived: reportsReceivedPosts + reportsReceivedMatrimony,
      reportsSubmitted: reportsSubmittedPosts + reportsSubmittedMatrimony,
      blockedUsers: blockedByUser
    },
    subscription: subscription
      ? {
          currentPlan: subscription.plan,
          status: subscription.status,
          startDate: subscription.startsAt?.toISOString() ?? null,
          endDate: subscription.endsAt?.toISOString() ?? null,
          remainingDays: remainingDays(subscription.endsAt),
          paymentMethod: "Razorpay",
          transactionId: subscription.paymentRef ?? subscription.razorpayOrderId ?? null,
          totalAmountPaidPaise: totalPaidPaise || subscription.amountPaise || 0,
          amountPaise: subscription.amountPaise
        }
      : null,
    storage: {
      byModule: storageRows.map((r) => ({
        module: r.module,
        fileType: r.fileType,
        bytes: Number(r.bytes || 0),
        files: Number(r.files || 0)
      })),
      totalBytes: totalStorageBytes
    },
    notificationPreferences: notificationPrefs
      ? {
          socialEnabled: notificationPrefs.socialEnabled,
          matrimonyEnabled: notificationPrefs.matrimonyEnabled,
          messagesEnabled: notificationPrefs.messagesEnabled,
          communityEnabled: notificationPrefs.communityEnabled,
          systemEnabled: notificationPrefs.systemEnabled,
          pushEnabled: notificationPrefs.pushEnabled
        }
      : null,
    devices: devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      deviceId: d.deviceId,
      appVersion: d.appVersion,
      lastUsedAt: d.lastUsedAt.toISOString(),
      createdAt: d.createdAt.toISOString()
    })),
    matrimonyStats: {
      profileStatus: profile?.matrimony?.matrimonySuspended
        ? "SUSPENDED"
        : profile?.matrimony?.matrimonyLifecycle === "PAUSED"
          ? "PAUSED"
          : profile?.matrimony?.matrimonyLifecycle === "CLOSED"
            ? "CLOSED"
            : profile?.matrimony?.matrimonyProfileActive
              ? "ACTIVE"
              : "INACTIVE",
      lifecycle: profile?.matrimony?.matrimonyLifecycle ?? null,
      interestSent,
      interestReceived,
      matches: matchesCount,
      blockedProfiles: blockedByUser,
      savedProfiles
    },
    marketplaceStats: {
      sellerStatus: profile?.business?.businessProfileActive ? "ACTIVE" : "INACTIVE",
      listings: marketplaceListings,
      soldItems: marketplaceSold,
      pendingListings: marketplacePending,
      rejectedListings: marketplaceRejected,
      business: profile?.business ?? null
    },
    reports: {
      reportsAgainstUser: reportsReceivedPosts + reportsReceivedMatrimony,
      reportsSubmitted: reportsSubmittedPosts + reportsSubmittedMatrimony,
      moderationActions: moderationActions.map((a) => ({
        id: a.id,
        action: a.action,
        note: a.note,
        adminEmail: a.adminEmail,
        createdAt: a.createdAt.toISOString()
      }))
    },
    security: {
      failedLoginAttempts: null as number | null,
      lastPasswordChange: null as string | null,
      passwordResetDate: null as string | null,
      deviceCount: devices.length,
      sessions: null as null,
      note: "Auth is OTP / Google OAuth — no password sessions stored."
    },
    roles: {
      userRole: "USER",
      communityRole: user.communityRole,
      adminAccess: false,
      moderatorAccess: false,
      permissions: [] as string[],
      profileVisibility: user.profileVisibility,
      allowConnectionRequests: user.allowConnectionRequests
    },
    timeline,
    loginSource: resolveLoginSource(user)
  };
}

export async function updateAdminUser(userId: number, input: AdminUserUpdateInput): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.status === "DELETED") {
    throw Object.assign(new Error("Cannot edit a soft-deleted user. Restore first."), { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const assign = <K extends keyof AdminUserUpdateInput>(key: K, column = key as string) => {
    if (input[key] !== undefined) updates[column] = input[key];
  };
  assign("fullName");
  assign("username");
  assign("gender");
  assign("dob");
  assign("email");
  assign("mobile");
  assign("occupation");
  assign("location");
  assign("community");
  assign("kulam");
  assign("bloodGroup");
  assign("education");
  assign("jobTitle");
  assign("company");
  assign("workLocation");
  assign("skills");
  assign("city");
  assign("district");
  assign("communityRole");
  assign("profileVisibility");
  assign("allowConnectionRequests");

  if (input.email && input.email !== user.email) {
    const existing = await User.findOne({ where: { email: input.email } });
    if (existing && existing.id !== userId) {
      throw Object.assign(new Error("Email already in use"), { status: 400 });
    }
  }
  if (input.username !== undefined && input.username && input.username !== user.username) {
    const existing = await User.findOne({ where: { username: input.username } });
    if (existing && existing.id !== userId) {
      throw Object.assign(new Error("Username already in use"), { status: 400 });
    }
  }

  await user.update(updates);
  return user.reload();
}

/** Soft delete — retain data, block login (status DELETED). */
export async function softDeleteUser(
  userId: number,
  adminEmail: string,
  reason?: string | null
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.status === "DELETED") {
    throw Object.assign(new Error("User is already soft-deleted"), { status: 400 });
  }
  await user.update({
    status: "DELETED",
    deletedAt: new Date(),
    deletedBy: adminEmail,
    deleteReason: reason?.trim() || null
  });
  void import("../utils/tokenRevocation")
    .then(({ revokeUserTokens }) => revokeUserTokens(userId, "soft_delete"))
    .catch(() => {});
  await ModerationAction.create({
    action: "SUSPEND",
    targetUserId: userId,
    reportKind: null,
    reportId: null,
    adminEmail,
    note: `SOFT_DELETE: ${reason?.trim() || "No reason"}`,
    createdAt: new Date()
  });
  return user.reload();
}

/** Restore a soft-deleted user to APPROVED. */
export async function restoreSoftDeletedUser(userId: number, adminEmail: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.status !== "DELETED") {
    throw Object.assign(new Error("User is not soft-deleted"), { status: 400 });
  }
  await user.update({
    status: "APPROVED",
    deletedAt: null,
    deletedBy: null,
    deleteReason: null
  });
  await ModerationAction.create({
    action: "REACTIVATE",
    targetUserId: userId,
    reportKind: null,
    reportId: null,
    adminEmail,
    note: "Restored from soft delete",
    createdAt: new Date()
  });
  return user.reload();
}

/**
 * Hard delete — remove R2 media + all related DB rows, then the user.
 * Irreversible.
 */
export async function hardDeleteUser(
  userId: number,
  adminEmail: string,
  reason?: string | null
): Promise<{ deletedUserId: number; r2ObjectsAttempted: number }> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const profile = await UserProfile.findOne({ where: { userId } });
  const posts = await Post.findAll({ where: { userId } });
  const mediaFiles = await MediaFile.findAll({ where: { userId } });
  const pendingUpdates = await PendingProfileUpdate.findAll({ where: { userId } });

  const urls = new Set<string>();
  collectUrl(urls, user.profilePhoto);
  collectUrl(urls, user.pendingProfilePhoto);
  collectUrl(urls, user.govtIdFile);
  collectMatrimonyUrls(urls, profile?.matrimony ?? null);
  for (const p of posts) {
    if (p.originalPostId) continue; // repost — no owned media copy
    collectUrl(urls, p.mediaUrl);
    collectUrl(urls, p.thumbnailUrl);
    if (Array.isArray(p.marketplaceGallery)) p.marketplaceGallery.forEach((u) => collectUrl(urls, u));
    if (Array.isArray(p.helpGallery)) p.helpGallery.forEach((u) => collectUrl(urls, u));
  }
  for (const m of mediaFiles) {
    collectUrl(urls, m.fileUrl);
    collectUrl(urls, m.objectKey);
  }
  for (const pu of pendingUpdates) collectPendingDataUrls(urls, pu.data);

  const r2ObjectsAttempted = await deleteR2Urls(urls);

  const postIds = posts.map((p) => p.id);

  await sequelize.transaction(async (t) => {
    const opts = { transaction: t };

    if (postIds.length) {
      await JobInterest.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await HelpOffer.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await HelpAppreciation.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await PostLike.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await Comment.destroy({
        where: { postId: { [Op.in]: postIds }, parentId: { [Op.ne]: null } },
        ...opts
      });
      await Comment.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await SavedPost.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await PostReport.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await PostHashtag.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      await FeedEngagementEvent.destroy({ where: { postId: { [Op.in]: postIds } }, ...opts });
      // Reposts of this user's posts
      await Post.destroy({ where: { originalPostId: { [Op.in]: postIds } }, ...opts });
    }

    // User engagement on others' content
    await PostLike.destroy({ where: { userId }, ...opts });
    await Comment.destroy({
      where: { userId, parentId: { [Op.ne]: null } },
      ...opts
    });
    await Comment.destroy({ where: { userId }, ...opts });
    await SavedPost.destroy({ where: { userId }, ...opts });
    await PostReport.destroy({ where: { reporterId: userId }, ...opts });
    await FeedEngagementEvent.destroy({ where: { userId }, ...opts });
    await JobInterest.destroy({ where: { fromUserId: userId }, ...opts });
    await HelpOffer.destroy({ where: { fromUserId: userId }, ...opts });
    await HelpAppreciation.destroy({
      where: { [Op.or]: [{ helperUserId: userId }, { fromUserId: userId }] },
      ...opts
    });

    await Post.update({ helpResolvedBy: null } as any, {
      where: { helpResolvedBy: userId },
      ...opts
    }).catch(() => undefined);

    if (postIds.length) {
      await Post.destroy({ where: { id: { [Op.in]: postIds } }, ...opts });
    }

    await MessageThreadPreference.destroy({
      where: { [Op.or]: [{ userId }, { otherUserId: userId }] },
      ...opts
    });
    await Message.destroy({
      where: { [Op.or]: [{ senderId: userId }, { recipientId: userId }] },
      ...opts
    });

    await MemberConnection.destroy({
      where: { [Op.or]: [{ requesterUserId: userId }, { recipientUserId: userId }] },
      ...opts
    });
    await MemberExpertiseSelection.destroy({ where: { userId }, ...opts });
    await MemberProfessionalIdentity.destroy({ where: { userId }, ...opts });

    const pendingIds = pendingUpdates.map((p) => p.id);
    if (pendingIds.length) {
      await MatrimonyAdminNote.destroy({
        where: { pendingUpdateId: { [Op.in]: pendingIds } },
        ...opts
      });
      await MatrimonyReviewAudit.destroy({
        where: { pendingUpdateId: { [Op.in]: pendingIds } },
        ...opts
      });
      await MatrimonyRequestMeta.destroy({
        where: { pendingUpdateId: { [Op.in]: pendingIds } },
        ...opts
      });
    }
    await MatrimonyRequestMeta.destroy({ where: { userId }, ...opts });
    await MatrimonyAdminNote.destroy({ where: { userId }, ...opts });
    await MatrimonyReviewAudit.destroy({ where: { userId }, ...opts });
    await MatrimonyInterest.destroy({
      where: { [Op.or]: [{ fromUserId: userId }, { toUserId: userId }] },
      ...opts
    });
    await MatrimonyMatch.destroy({
      where: { [Op.or]: [{ userLowId: userId }, { userHighId: userId }] },
      ...opts
    });
    await MatrimonySavedProfile.destroy({
      where: { [Op.or]: [{ userId }, { savedUserId: userId }] },
      ...opts
    });
    await MatrimonyBlock.destroy({
      where: { [Op.or]: [{ userId }, { blockedUserId: userId }] },
      ...opts
    });
    await MatrimonyReport.destroy({
      where: { [Op.or]: [{ reporterId: userId }, { reportedUserId: userId }] },
      ...opts
    });
    await MatrimonyProfileOpen.destroy({
      where: { [Op.or]: [{ userId }, { candidateUserId: userId }] },
      ...opts
    });
    await MatrimonyContactReveal.destroy({
      where: { [Op.or]: [{ userId }, { targetUserId: userId }] },
      ...opts
    });
    await MatrimonyProfileView.destroy({
      where: { [Op.or]: [{ viewerId: userId }, { viewedUserId: userId }] },
      ...opts
    });
    await MatrimonySubscription.destroy({ where: { userId }, ...opts });
    await MatrimonyPaymentOrder.destroy({ where: { userId }, ...opts });
    await PendingProfileUpdate.destroy({ where: { userId }, ...opts });

    await Notification.destroy({
      where: { [Op.or]: [{ userId }, { actorUserId: userId }] },
      ...opts
    });
    await NotificationPreference.destroy({ where: { userId }, ...opts });
    await PushDeviceToken.destroy({ where: { userId }, ...opts });
    await PlatformPopupAck.destroy({ where: { userId }, ...opts });

    const tickets = await SupportTicket.findAll({ where: { userId }, ...opts });
    const ticketIds = tickets.map((x) => x.id);
    if (ticketIds.length) {
      await SupportTicketMessage.destroy({ where: { ticketId: { [Op.in]: ticketIds } }, ...opts });
      await SupportTicket.destroy({ where: { id: { [Op.in]: ticketIds } }, ...opts });
    }
    await SupportTicketMessage.update({ authorUserId: null } as any, {
      where: { authorUserId: userId },
      ...opts
    }).catch(() => undefined);

    await MediaFile.destroy({ where: { userId }, ...opts });
    await Otp.destroy({ where: { userId }, ...opts });
    await AdminVerification.destroy({ where: { userId }, ...opts });
    await UsernameReservation.destroy({ where: { reservedForUserId: userId }, ...opts });
    await AuthAnalyticsEvent.destroy({ where: { userId }, ...opts });
    await ModerationAction.destroy({ where: { targetUserId: userId }, ...opts });

    // Audit trail of hard delete (no target after user gone — log before)
    await ModerationAction.create(
      {
        action: "DISMISS",
        targetUserId: null,
        reportKind: null,
        reportId: null,
        adminEmail,
        note: `HARD_DELETE userId=${userId} email=${user.email} reason=${reason?.trim() || "n/a"}`,
        createdAt: new Date()
      },
      opts
    );

    await UserProfile.destroy({ where: { userId }, ...opts });
    await User.destroy({ where: { id: userId }, ...opts });
  });

  return { deletedUserId: userId, r2ObjectsAttempted };
}
