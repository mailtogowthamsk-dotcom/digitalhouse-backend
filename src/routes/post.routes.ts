import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as PostController from "../controllers/Post.controller";

export const postRouter = Router();

postRouter.use(routeApiLimiter(150));

postRouter.post("/events", authMiddleware, asyncHandler(PostController.trackEvent));
postRouter.post("/", authMiddleware, asyncHandler(PostController.createPost));
postRouter.get(
  "/my-job-applications",
  authMiddleware,
  asyncHandler(PostController.listMyJobApplications)
);
postRouter.get(
  "/my-job-applications/:interestId",
  authMiddleware,
  asyncHandler(PostController.getMyJobApplicationDetail)
);
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
postRouter.patch(
  "/:postId/job-interests/:interestId",
  authMiddleware,
  asyncHandler(PostController.updateJobInterest)
);
postRouter.post(
  "/:postId/job-interests/:interestId/withdraw",
  authMiddleware,
  asyncHandler(PostController.withdrawJobInterest)
);
