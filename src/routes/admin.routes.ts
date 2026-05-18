import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as AdminController from "../controllers/Admin.controller";
import * as MatrimonyAdminController from "../controllers/MatrimonyAdmin.controller";

export const adminRouter = Router();

/** Public: admin login (email + password) → JWT */
adminRouter.post("/login", asyncHandler(AdminController.login));

adminRouter.use(adminMiddleware);

adminRouter.get("/stats", asyncHandler(AdminController.getStats));
adminRouter.get("/users", asyncHandler(AdminController.listUsers));
adminRouter.get("/pending", asyncHandler(AdminController.listPending));
adminRouter.get("/users/:id", asyncHandler(AdminController.getUser));
adminRouter.post("/users/:id/approve", asyncHandler(AdminController.approveUser));
adminRouter.post("/users/:id/reject", asyncHandler(AdminController.rejectUser));
adminRouter.get("/media/pending", asyncHandler(AdminController.listPendingMedia));
adminRouter.post("/media/:id/approve", asyncHandler(AdminController.approveMedia));
adminRouter.post("/media/:id/reject", asyncHandler(AdminController.rejectMedia));

// Pending profile updates (Matrimony / Business)
adminRouter.get("/pending-updates", asyncHandler(AdminController.listPendingUpdates));
adminRouter.post("/approve-update", asyncHandler(AdminController.approveUpdate));
adminRouter.post("/reject-update", asyncHandler(AdminController.rejectUpdate));

// Matrimony admin module
adminRouter.get("/matrimony/stats", asyncHandler(MatrimonyAdminController.getStats));
adminRouter.get("/matrimony/config", asyncHandler(MatrimonyAdminController.getConfig));
adminRouter.get("/matrimony/requests", asyncHandler(MatrimonyAdminController.listRequests));
adminRouter.post("/matrimony/bulk", asyncHandler(MatrimonyAdminController.bulkAction));
adminRouter.get("/matrimony/requests/:id", asyncHandler(MatrimonyAdminController.getRequestDetail));
adminRouter.post("/matrimony/requests/:id/assign", asyncHandler(MatrimonyAdminController.assignReviewer));
adminRouter.post("/matrimony/requests/:id/approve", asyncHandler(MatrimonyAdminController.approveRequest));
adminRouter.post("/matrimony/requests/:id/reject", asyncHandler(MatrimonyAdminController.rejectRequest));
adminRouter.post(
  "/matrimony/requests/:id/request-changes",
  asyncHandler(MatrimonyAdminController.requestChanges)
);
adminRouter.post("/matrimony/requests/:id/suspend", asyncHandler(MatrimonyAdminController.suspendProfile));
adminRouter.post(
  "/matrimony/requests/:id/verification",
  asyncHandler(MatrimonyAdminController.updateVerification)
);
adminRouter.post("/matrimony/requests/:id/notes", asyncHandler(MatrimonyAdminController.addNote));
