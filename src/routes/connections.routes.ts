import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as ConnectionsController from "../controllers/Connections.controller";

export const connectionsRouter = Router();

connectionsRouter.use(routeApiLimiter(180));
connectionsRouter.use(authMiddleware);

connectionsRouter.get("/requests/count", asyncHandler(ConnectionsController.requestCount));
connectionsRouter.get("/requests", asyncHandler(ConnectionsController.listRequests));
connectionsRouter.get("/", asyncHandler(ConnectionsController.listConnections));
connectionsRouter.post("/:userId/request", asyncHandler(ConnectionsController.sendRequest));
connectionsRouter.post("/:userId/accept", asyncHandler(ConnectionsController.acceptRequest));
connectionsRouter.post("/:userId/reject", asyncHandler(ConnectionsController.rejectRequest));
connectionsRouter.post("/:userId/cancel", asyncHandler(ConnectionsController.cancelRequest));
connectionsRouter.post("/:userId/disconnect", asyncHandler(ConnectionsController.disconnect));
