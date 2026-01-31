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

postRouter.post("/", authMiddleware, asyncHandler(PostController.createPost));
postRouter.get("/:postId", authMiddleware, asyncHandler(PostController.getPost));
postRouter.put("/:postId", authMiddleware, asyncHandler(PostController.updatePost));
postRouter.delete("/:postId", authMiddleware, asyncHandler(PostController.deletePost));
postRouter.post("/:postId/like", authMiddleware, asyncHandler(PostController.likePost));
postRouter.post("/:postId/comments", authMiddleware, asyncHandler(PostController.addComment));
postRouter.get("/:postId/comments", authMiddleware, asyncHandler(PostController.getComments));
postRouter.post("/:postId/report", authMiddleware, asyncHandler(PostController.reportPost));
