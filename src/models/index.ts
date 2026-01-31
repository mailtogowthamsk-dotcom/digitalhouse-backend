import { User } from "./user.model";
import { Otp } from "./otp.model";
import { AdminVerification } from "./AdminVerification.model";
import { Location } from "./Location.model";
import { Kulam } from "./Kulam.model";
import { Post } from "./Post.model";
import { Notification } from "./Notification.model";
import { Message } from "./Message.model";
import { PostLike } from "./PostLike.model";
import { Comment } from "./Comment.model";
import { SavedPost } from "./SavedPost.model";
import { PostReport } from "./PostReport.model";

// Auth / options
User.hasMany(Otp, { foreignKey: "userId" });
Otp.belongsTo(User, { foreignKey: "userId" });
User.hasMany(AdminVerification, { foreignKey: "userId" });
AdminVerification.belongsTo(User, { foreignKey: "userId" });

// Home / feed
User.hasMany(Post, { foreignKey: "userId" });
Post.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Notification, { foreignKey: "userId" });
Notification.belongsTo(User, { foreignKey: "userId" });
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
Post.hasMany(SavedPost, { foreignKey: "postId" });
SavedPost.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(SavedPost, { foreignKey: "userId" });
SavedPost.belongsTo(User, { foreignKey: "userId" });
Post.hasMany(PostReport, { foreignKey: "postId" });
PostReport.belongsTo(Post, { foreignKey: "postId" });
User.hasMany(PostReport, { foreignKey: "reporterId" });
PostReport.belongsTo(User, { foreignKey: "reporterId" });

export type { UserStatus } from "./user.model";
export type { PostType, JobStatus } from "./Post.model";
export { POST_TYPES, JOB_STATUSES } from "./Post.model";
export type { ReportStatus } from "./PostReport.model";
export {
  User,
  Otp,
  AdminVerification,
  Location,
  Kulam,
  Post,
  Notification,
  Message,
  PostLike,
  Comment,
  SavedPost,
  PostReport
};
