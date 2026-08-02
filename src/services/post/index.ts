export type {
  PostAuthorDto,
  PostDetailDto,
  CommentDto,
  CommentsResultDto,
  PostLikerDto,
  PostLikesResultDto,
  CreatePostPayload,
  UpdatePostPayload
} from "./types";

export { getApprovedUserIdsInCommunity } from "./access";

export { createPost, updatePost } from "./write.service";
export { getPost, deletePost } from "./read.service";
export {
  likePost,
  addComment,
  getComments,
  updateComment,
  deleteComment,
  savePost,
  unsavePost,
  getPostLikes
} from "./engagement.service";
export { reportPost, trackFeedEvent, trackFeedEvents } from "./moderation.service";

import { getApprovedUserIdsInCommunity } from "./access";
import { createPost, updatePost } from "./write.service";
import { getPost, deletePost } from "./read.service";
import {
  likePost,
  addComment,
  getComments,
  updateComment,
  deleteComment,
  savePost,
  unsavePost,
  getPostLikes
} from "./engagement.service";
import { reportPost, trackFeedEvent, trackFeedEvents } from "./moderation.service";

export const postService = {
  createPost,
  updatePost,
  deletePost,
  getPost,
  likePost,
  addComment,
  getComments,
  getPostLikes,
  updateComment,
  deleteComment,
  savePost,
  unsavePost,
  reportPost,
  trackFeedEvent,
  trackFeedEvents,
  getApprovedUserIdsInCommunity
};
