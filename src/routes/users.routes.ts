import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as UsersDirectoryController from "../controllers/UsersDirectory.controller";

export const usersRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

usersRouter.use(limiter);
usersRouter.use(authMiddleware);

usersRouter.get("/", asyncHandler(UsersDirectoryController.listUsers));
usersRouter.get("/search", asyncHandler(UsersDirectoryController.searchUsers));

