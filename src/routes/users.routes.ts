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
usersRouter.get("/username/availability", asyncHandler(UsersDirectoryController.checkUsernameAvailability));
usersRouter.get("/username/eligibility", asyncHandler(UsersDirectoryController.getUsernameEligibility));
usersRouter.post("/username", asyncHandler(UsersDirectoryController.setUsername));
usersRouter.put("/username", asyncHandler(UsersDirectoryController.changeUsername));
usersRouter.patch("/me/visibility", asyncHandler(UsersDirectoryController.updateVisibility));
usersRouter.patch("/me/connection-requests", asyncHandler(UsersDirectoryController.updateConnectionRequests));
usersRouter.get("/me/blocks", asyncHandler(UsersDirectoryController.listBlockedUsers));
usersRouter.post("/:userId/block", asyncHandler(UsersDirectoryController.blockUser));
usersRouter.delete("/:userId/block", asyncHandler(UsersDirectoryController.unblockUser));
usersRouter.post("/:userId/report", asyncHandler(UsersDirectoryController.reportUser));
usersRouter.get("/:identifier", asyncHandler(UsersDirectoryController.getMemberProfile));
