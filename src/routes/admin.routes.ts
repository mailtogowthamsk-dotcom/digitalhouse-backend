import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as AdminController from "../controllers/Admin.controller";

export const adminRouter = Router();

adminRouter.use(adminMiddleware);

adminRouter.get("/pending", asyncHandler(AdminController.listPending));
adminRouter.get("/users/:id", asyncHandler(AdminController.getUser));
adminRouter.post("/users/:id/approve", asyncHandler(AdminController.approveUser));
adminRouter.post("/users/:id/reject", asyncHandler(AdminController.rejectUser));
