import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as PostController from "../controllers/Post.controller";

export const postRouter = Router();

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

postRouter.use(postLimiter);

postRouter.post("/events", authMiddleware, asyncHandler(PostController.trackEvent));
postRouter.post("/", authMiddleware, asyncHandler(PostController.createPost));
postRouter.get("/:postId", authMiddleware, asyncHandler(PostController.getPost));
postRouter.put("/:postId", authMiddleware, asyncHandler(PostController.updatePost));
postRouter.delete("/:postId", authMiddleware, asyncHandler(PostController.deletePost));
postRouter.post("/:postId/like", authMiddleware, asyncHandler(PostController.likePost));
postRouter.get("/:postId/likes", authMiddleware, asyncHandler(PostController.getPostLikes));
postRouter.post("/:postId/save", authMiddleware, asyncHandler(PostController.savePost));
postRouter.delete("/:postId/save", authMiddleware, asyncHandler(PostController.unsavePost));
postRouter.post("/:postId/comments", authMiddleware, asyncHandler(PostController.addComment));
postRouter.get("/:postId/comments", authMiddleware, asyncHandler(PostController.getComments));
postRouter.patch(
  "/:postId/comments/:commentId",
  authMiddleware,
  asyncHandler(PostController.updateComment)
);
postRouter.delete(
  "/:postId/comments/:commentId",
  authMiddleware,
  asyncHandler(PostController.deleteComment)
);
postRouter.post("/:postId/share", authMiddleware, asyncHandler(PostController.sharePost));
postRouter.post("/:postId/repost", authMiddleware, asyncHandler(PostController.repostPost));
postRouter.post("/:postId/report", authMiddleware, asyncHandler(PostController.reportPost));
postRouter.post(
  "/:postId/job-interest",
  authMiddleware,
  asyncHandler(PostController.expressJobInterest)
);
postRouter.get(
  "/:postId/job-interests",
  authMiddleware,
  asyncHandler(PostController.listJobInterests)
);
