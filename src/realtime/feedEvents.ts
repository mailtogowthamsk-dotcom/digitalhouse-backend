import { getIo, communityRoom } from "./io";

export type FeedLikePayload = {
  postId: number;
  likeCount: number;
  likedByUserId: number;
  liked: boolean;
};

export type FeedCommentPayload = {
  postId: number;
  commentCount: number;
  commentId: number;
  userId: number;
  preview?: string;
};

export type FeedSavePayload = {
  postId: number;
  userId: number;
  saved: boolean;
};

export function emitFeedLike(community: string | null, payload: FeedLikePayload): void {
  getIo()?.to(communityRoom(community)).emit("feed:like", payload);
}

export function emitFeedComment(community: string | null, payload: FeedCommentPayload): void {
  getIo()?.to(communityRoom(community)).emit("feed:comment", payload);
}

export function emitFeedSave(community: string | null, payload: FeedSavePayload): void {
  getIo()?.to(communityRoom(community)).emit("feed:save", payload);
}

export function emitFeedNewPost(community: string | null, postId: number): void {
  getIo()?.to(communityRoom(community)).emit("feed:new_post", { postId });
}
