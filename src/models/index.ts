import { User } from "./user.model";
import { UserProfile } from "./UserProfile.model";
import { PendingProfileUpdate } from "./PendingProfileUpdate.model";
import { Otp } from "./otp.model";
import { AdminVerification } from "./AdminVerification.model";
import { Location } from "./Location.model";
import { Kulam } from "./Kulam.model";
import { Post } from "./Post.model";
import { Notification } from "./Notification.model";
import { NotificationPreference } from "./NotificationPreference.model";
import { PushDeviceToken } from "./PushDeviceToken.model";
import { Message } from "./Message.model";
import { PostLike } from "./PostLike.model";
import { Comment } from "./Comment.model";
import { SavedPost } from "./SavedPost.model";
import { PostReport } from "./PostReport.model";
import { FeedEngagementEvent } from "./FeedEngagementEvent.model";
import { MediaFile } from "./MediaFile.model";
import { MatrimonyRequestMeta } from "./MatrimonyRequestMeta.model";
import { MatrimonyAdminNote } from "./MatrimonyAdminNote.model";
import { MatrimonyReviewAudit } from "./MatrimonyReviewAudit.model";
import { MatrimonyInterest } from "./MatrimonyInterest.model";
import { MatrimonyMatch } from "./MatrimonyMatch.model";
import { MatrimonySavedProfile } from "./MatrimonySavedProfile.model";
import { MatrimonyBlock } from "./MatrimonyBlock.model";
import { MatrimonyReport } from "./MatrimonyReport.model";
import { MatrimonySubscription } from "./MatrimonySubscription.model";
import { MatrimonyProfileOpen } from "./MatrimonyProfileOpen.model";
import { MatrimonyContactReveal } from "./MatrimonyContactReveal.model";
import { MatrimonyProfileView } from "./MatrimonyProfileView.model";
import { MatrimonyPaymentOrder } from "./MatrimonyPaymentOrder.model";
import { RazorpayWebhookEvent } from "./RazorpayWebhookEvent.model";
import { AuthAnalyticsEvent } from "./AuthAnalyticsEvent.model";
import { UsernameReservation } from "./UsernameReservation.model";
import { MessageThreadPreference } from "./MessageThreadPreference.model";
import { JobInterest } from "./JobInterest.model";
import { HelpOffer } from "./HelpOffer.model";
import { HelpAppreciation } from "./HelpAppreciation.model";
import { MemberConnection } from "./MemberConnection.model";
import { MasterDataType } from "./MasterDataType.model";
import { MasterDataItem } from "./MasterDataItem.model";
import { MasterDataAudit } from "./MasterDataAudit.model";
import { ModerationAction } from "./ModerationAction.model";
import {
  PlatformAppVersion,
  PlatformMaintenance,
  PlatformNotification,
  PlatformAlertPopup,
  PlatformPopupAck,
  PlatformAnnouncement,
  PlatformBanner,
  PlatformFeatureFlag,
  PlatformMenuItem,
  PlatformAd,
  PlatformAuditLog
} from "./Platform.models";

// Auth / options
User.hasMany(Otp, { foreignKey: "userId" });
Otp.belongsTo(User, { foreignKey: "userId" });
User.hasOne(UserProfile, { foreignKey: "userId" });
UserProfile.belongsTo(User, { foreignKey: "userId" });
User.hasMany(PendingProfileUpdate, { foreignKey: "userId", as: "PendingProfileUpdates" });
PendingProfileUpdate.belongsTo(User, { foreignKey: "userId", as: "User" });
MatrimonyRequestMeta.belongsTo(PendingProfileUpdate, { foreignKey: "pendingUpdateId" });
MatrimonyAdminNote.belongsTo(PendingProfileUpdate, { foreignKey: "pendingUpdateId" });
MatrimonyReviewAudit.belongsTo(PendingProfileUpdate, { foreignKey: "pendingUpdateId" });
User.hasMany(AdminVerification, { foreignKey: "userId" });
AdminVerification.belongsTo(User, { foreignKey: "userId" });

// Home / feed
User.hasMany(Post, { foreignKey: "userId" });
Post.belongsTo(User, { foreignKey: "userId" });
Post.hasMany(JobInterest, { foreignKey: "postId" });
JobInterest.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(JobInterest, { foreignKey: "fromUserId", as: "JobInterestsSent" });
JobInterest.belongsTo(User, { foreignKey: "fromUserId", as: "FromUser" });
Post.hasMany(HelpOffer, { foreignKey: "postId" });
HelpOffer.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(HelpOffer, { foreignKey: "fromUserId", as: "HelpOffersSent" });
HelpOffer.belongsTo(User, { foreignKey: "fromUserId", as: "FromUser" });
Post.hasMany(HelpAppreciation, { foreignKey: "postId" });
HelpAppreciation.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(HelpAppreciation, { foreignKey: "helperUserId", as: "HelpAppreciationsReceived" });
HelpAppreciation.belongsTo(User, { foreignKey: "helperUserId", as: "HelperUser" });
User.hasMany(HelpAppreciation, { foreignKey: "fromUserId", as: "HelpAppreciationsSent" });
HelpAppreciation.belongsTo(User, { foreignKey: "fromUserId", as: "FromUser" });
User.hasMany(Notification, { foreignKey: "userId" });
Notification.belongsTo(User, { foreignKey: "userId" });
User.hasOne(NotificationPreference, { foreignKey: "userId" });
NotificationPreference.belongsTo(User, { foreignKey: "userId" });
User.hasMany(PushDeviceToken, { foreignKey: "userId" });
PushDeviceToken.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Message, { foreignKey: "senderId" });
Message.belongsTo(User, { foreignKey: "senderId" });
User.hasMany(Message, { foreignKey: "recipientId" });
Message.belongsTo(User, { foreignKey: "recipientId" });
Post.hasMany(PostLike, { foreignKey: "postId" });
PostLike.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(PostLike, { foreignKey: "userId" });
PostLike.belongsTo(User, { foreignKey: "userId" });
Post.hasMany(Comment, { foreignKey: "postId" });
Comment.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(Comment, { foreignKey: "userId" });
Comment.belongsTo(User, { foreignKey: "userId" });
Comment.belongsTo(Comment, { as: "parent", foreignKey: "parentId" });
Comment.hasMany(Comment, { as: "replies", foreignKey: "parentId" });
User.hasMany(FeedEngagementEvent, { foreignKey: "userId" });
FeedEngagementEvent.belongsTo(User, { foreignKey: "userId" });
Post.hasMany(SavedPost, { foreignKey: "postId" });
SavedPost.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(SavedPost, { foreignKey: "userId" });
SavedPost.belongsTo(User, { foreignKey: "userId" });
Post.hasMany(PostReport, { foreignKey: "postId" });
PostReport.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(PostReport, { foreignKey: "reporterId" });
PostReport.belongsTo(User, { foreignKey: "reporterId" });
User.hasMany(MediaFile, { foreignKey: "userId" });
MediaFile.belongsTo(User, { foreignKey: "userId" });

MasterDataItem.belongsTo(MasterDataItem, { foreignKey: "parentId", as: "Parent" });
MasterDataItem.hasMany(MasterDataItem, { foreignKey: "parentId", as: "Children" });
MasterDataItem.hasMany(MasterDataAudit, { foreignKey: "itemId" });
MasterDataAudit.belongsTo(MasterDataItem, { foreignKey: "itemId" });

export type { UserStatus } from "./user.model";
export type { PostType, JobStatus, JobEmploymentType } from "./Post.model";
export { POST_TYPES, JOB_STATUSES, JOB_EMPLOYMENT_TYPES } from "./Post.model";
export type { ReportStatus } from "./PostReport.model";
export type { MediaStatus, MediaFileType, MediaModule } from "./MediaFile.model";
export { MEDIA_MODULES } from "./MediaFile.model";
export {
  User,
  UserProfile,
  PendingProfileUpdate,
  Otp,
  AdminVerification,
  Location,
  Kulam,
  Post,
  Notification,
  NotificationPreference,
  PushDeviceToken,
  Message,
  PostLike,
  Comment,
  SavedPost,
  PostReport,
  MediaFile,
  FeedEngagementEvent,
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
  RazorpayWebhookEvent,
  AuthAnalyticsEvent,
  UsernameReservation,
  MemberConnection,
  MessageThreadPreference,
  JobInterest,
  HelpOffer,
  HelpAppreciation,
  MasterDataType,
  MasterDataItem,
  MasterDataAudit,
  ModerationAction,
  PlatformAppVersion,
  PlatformMaintenance,
  PlatformNotification,
  PlatformAlertPopup,
  PlatformPopupAck,
  PlatformAnnouncement,
  PlatformBanner,
  PlatformFeatureFlag,
  PlatformMenuItem,
  PlatformAd,
  PlatformAuditLog
};
