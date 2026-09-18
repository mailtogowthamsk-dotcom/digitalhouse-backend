import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as UsersDirectoryController from "../controllers/UsersDirectory.controller";

export const usersRouter = Router();

usersRouter.use(routeApiLimiter(240));
usersRouter.use(authMiddleware);

usersRouter.get("/", asyncHandler(UsersDirectoryController.listUsers));
usersRouter.get("/search", asyncHandler(UsersDirectoryController.searchUsers));
usersRouter.get("/username/availability", asyncHandler(UsersDirectoryController.checkUsernameAvailability));
usersRouter.get("/username/eligibility", asyncHandler(UsersDirectoryController.getUsernameEligibility));
usersRouter.post("/username", asyncHandler(UsersDirectoryController.setUsername));
usersRouter.put("/username", asyncHandler(UsersDirectoryController.changeUsername));
usersRouter.patch("/me/visibility", asyncHandler(UsersDirectoryController.updateVisibility));
usersRouter.patch("/me/connection-requests", asyncHandler(UsersDirectoryController.updateConnectionRequests));
usersRouter.get("/me/last-seen-visibility", asyncHandler(UsersDirectoryController.getLastSeenVisibility));
usersRouter.patch("/me/last-seen-visibility", asyncHandler(UsersDirectoryController.updateLastSeenVisibility));
usersRouter.get("/me/blocks", asyncHandler(UsersDirectoryController.listBlockedUsers));
usersRouter.post("/:userId/block", asyncHandler(UsersDirectoryController.blockUser));
usersRouter.delete("/:userId/block", asyncHandler(UsersDirectoryController.unblockUser));
usersRouter.post("/:userId/report", asyncHandler(UsersDirectoryController.reportUser));
usersRouter.get("/:identifier/posts", asyncHandler(UsersDirectoryController.getMemberPosts));
usersRouter.get("/:identifier", asyncHandler(UsersDirectoryController.getMemberProfile));
