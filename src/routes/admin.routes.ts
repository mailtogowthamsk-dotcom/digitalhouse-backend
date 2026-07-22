import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authLimiter } from "../middlewares/rateLimit.middleware";
import * as AdminController from "../controllers/Admin.controller";
import * as MatrimonyAdminController from "../controllers/MatrimonyAdmin.controller";
import * as MatrimonySubscriptionAdminController from "../controllers/MatrimonySubscriptionAdmin.controller";
import * as AdminJobsController from "../controllers/AdminJobs.controller";
import * as AdminMarketplaceController from "../controllers/AdminMarketplace.controller";
import * as AdminMasterDataController from "../controllers/AdminMasterData.controller";
import * as AdminHelpingHandsController from "../controllers/AdminHelpingHands.controller";
import * as AdminReportsController from "../controllers/AdminReports.controller";
import * as AdminSupportController from "../controllers/AdminSupport.controller";
import * as AdminSettingsController from "../controllers/AdminSettings.controller";
import { requireAdminAction } from "../controllers/AdminSettings.controller";
import * as PlatformController from "../controllers/Platform.controller";

export const adminRouter = Router();

/** Public: admin login (email + password) → JWT */
adminRouter.post("/login", authLimiter, asyncHandler(AdminController.login));

adminRouter.use(adminMiddleware);

adminRouter.get(
  "/notifications/stats",
  asyncHandler(AdminController.notificationStats)
);
adminRouter.post(
  "/notifications/broadcast",
  requireAdminAction("notifications.broadcast"),
  asyncHandler(AdminController.broadcastNotifications)
);
adminRouter.get("/stats", asyncHandler(AdminController.getStats));
adminRouter.get("/users", asyncHandler(AdminController.listUsers));
adminRouter.get("/pending", asyncHandler(AdminController.listPending));
adminRouter.get("/users/:id", asyncHandler(AdminController.getUser));
adminRouter.post(
  "/users/:id/approve",
  requireAdminAction("users.approve"),
  asyncHandler(AdminController.approveUser)
);
adminRouter.post(
  "/users/:id/reject",
  requireAdminAction("users.approve"),
  asyncHandler(AdminController.rejectUser)
);
adminRouter.post(
  "/users/:id/warn",
  requireAdminAction("reports.warn"),
  asyncHandler(AdminReportsController.warnUser)
);
adminRouter.post(
  "/users/:id/suspend",
  requireAdminAction("users.suspend"),
  asyncHandler(AdminReportsController.suspendUser)
);
adminRouter.post(
  "/users/:id/reactivate",
  requireAdminAction("users.suspend"),
  asyncHandler(AdminReportsController.reactivateUser)
);
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
adminRouter.put("/matrimony/platform-settings", asyncHandler(MatrimonyAdminController.updatePlatformSettings));
adminRouter.get("/matrimony/requests", asyncHandler(MatrimonyAdminController.listRequests));
adminRouter.post("/matrimony/bulk", asyncHandler(MatrimonyAdminController.bulkAction));
adminRouter.get("/matrimony/requests/:id", asyncHandler(MatrimonyAdminController.getRequestDetail));
adminRouter.post("/matrimony/requests/:id/assign", asyncHandler(MatrimonyAdminController.assignReviewer));
adminRouter.post("/matrimony/requests/:id/approve", asyncHandler(MatrimonyAdminController.approveRequest));
adminRouter.post(
  "/matrimony/requests/:id/candidate-photo",
  asyncHandler(MatrimonyAdminController.updateCandidatePhoto)
);
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
adminRouter.get("/matrimony/reports", asyncHandler(MatrimonyAdminController.listReports));
adminRouter.post("/matrimony/reports/:id/resolve", asyncHandler(MatrimonyAdminController.resolveReport));

// Matrimony subscriptions & revenue (P2)
adminRouter.get(
  "/matrimony/subscriptions/overview",
  asyncHandler(MatrimonySubscriptionAdminController.getOverview)
);
adminRouter.get(
  "/matrimony/subscriptions/reports",
  asyncHandler(MatrimonySubscriptionAdminController.getReports)
);
adminRouter.get(
  "/matrimony/subscriptions",
  asyncHandler(MatrimonySubscriptionAdminController.listSubscriptions)
);
adminRouter.get(
  "/matrimony/subscriptions/export",
  asyncHandler(MatrimonySubscriptionAdminController.exportSubscriptions)
);
adminRouter.get(
  "/matrimony/subscriptions/revenue-export",
  asyncHandler(MatrimonySubscriptionAdminController.exportRevenue)
);
adminRouter.get(
  "/matrimony/subscriptions/payments",
  asyncHandler(MatrimonySubscriptionAdminController.listPayments)
);
adminRouter.get(
  "/matrimony/subscriptions/payments/export",
  asyncHandler(MatrimonySubscriptionAdminController.exportPayments)
);
adminRouter.get(
  "/matrimony/subscriptions/:id",
  asyncHandler(MatrimonySubscriptionAdminController.getDetail)
);
adminRouter.post(
  "/matrimony/subscriptions/grant",
  asyncHandler(MatrimonySubscriptionAdminController.grantSubscription)
);
adminRouter.post(
  "/matrimony/subscriptions/payments/:orderId/refund",
  asyncHandler(MatrimonySubscriptionAdminController.recordRefund)
);

// Jobs portal moderation (Phase 3)
adminRouter.get("/jobs", asyncHandler(AdminJobsController.listJobs));
adminRouter.post("/jobs/:id/close", asyncHandler(AdminJobsController.closeJob));
adminRouter.post("/jobs/:id/reopen", asyncHandler(AdminJobsController.reopenJob));
adminRouter.delete("/jobs/:id", asyncHandler(AdminJobsController.deleteJob));

// Marketplace moderation
adminRouter.get("/marketplace", asyncHandler(AdminMarketplaceController.listMarketplace));
adminRouter.post(
  "/marketplace/:id/approve",
  asyncHandler(AdminMarketplaceController.approveListing)
);
adminRouter.post(
  "/marketplace/:id/reject",
  asyncHandler(AdminMarketplaceController.rejectListing)
);
adminRouter.post(
  "/marketplace/:id/request-changes",
  asyncHandler(AdminMarketplaceController.requestChanges)
);
adminRouter.post(
  "/marketplace/:id/hide",
  asyncHandler(AdminMarketplaceController.hideListing)
);
adminRouter.post(
  "/marketplace/:id/unhide",
  asyncHandler(AdminMarketplaceController.unhideListing)
);
adminRouter.post(
  "/marketplace/:id/dismiss-reports",
  asyncHandler(AdminMarketplaceController.dismissReports)
);
adminRouter.post(
  "/marketplace/:id/feature",
  asyncHandler(AdminMarketplaceController.setFeatured)
);
adminRouter.delete("/marketplace/:id", asyncHandler(AdminMarketplaceController.deleteListing));

// Helping Hands moderation
adminRouter.get("/helping-hands", asyncHandler(AdminHelpingHandsController.listHelpRequests));
adminRouter.get("/helping-hands/:id", asyncHandler(AdminHelpingHandsController.getHelpRequest));
adminRouter.post(
  "/helping-hands/:id/status",
  asyncHandler(AdminHelpingHandsController.setHelpStatus)
);
adminRouter.post(
  "/helping-hands/:id/cancel",
  asyncHandler(AdminHelpingHandsController.cancelHelpRequest)
);
adminRouter.post(
  "/helping-hands/:id/reopen",
  asyncHandler(AdminHelpingHandsController.reopenHelpRequest)
);
adminRouter.post(
  "/helping-hands/:id/complete",
  asyncHandler(AdminHelpingHandsController.completeHelpRequest)
);
adminRouter.post(
  "/helping-hands/:id/expire",
  asyncHandler(AdminHelpingHandsController.expireHelpRequest)
);
adminRouter.post(
  "/helping-hands/:id/extend",
  asyncHandler(AdminHelpingHandsController.extendHelpRequest)
);
adminRouter.delete(
  "/helping-hands/:id",
  asyncHandler(AdminHelpingHandsController.deleteHelpRequest)
);

// Help & Support
adminRouter.get("/support/tickets", asyncHandler(AdminSupportController.listTickets));
adminRouter.get("/support/tickets/:ticketId", asyncHandler(AdminSupportController.getTicket));
adminRouter.patch("/support/tickets/:ticketId", asyncHandler(AdminSupportController.updateTicket));
adminRouter.get("/support/faqs", asyncHandler(AdminSupportController.listFaqs));
adminRouter.post("/support/faqs", asyncHandler(AdminSupportController.createFaq));
adminRouter.put("/support/faqs/:faqId", asyncHandler(AdminSupportController.updateFaq));
adminRouter.delete("/support/faqs/:faqId", asyncHandler(AdminSupportController.deleteFaq));
adminRouter.get("/support/guides", asyncHandler(AdminSupportController.listGuides));
adminRouter.post("/support/guides", asyncHandler(AdminSupportController.createGuide));
adminRouter.put("/support/guides/:guideId", asyncHandler(AdminSupportController.upsertGuide));
adminRouter.delete("/support/guides/:guideId", asyncHandler(AdminSupportController.deleteGuide));
adminRouter.get("/support/contact", asyncHandler(AdminSupportController.getContact));
adminRouter.put("/support/contact", asyncHandler(AdminSupportController.updateContact));


// Master Data Management
adminRouter.get("/master-data/types", asyncHandler(AdminMasterDataController.listTypes));
adminRouter.get("/master-data/items", asyncHandler(AdminMasterDataController.listItems));
adminRouter.post(
  "/master-data/items",
  requireAdminAction("master_data.write"),
  asyncHandler(AdminMasterDataController.createItem)
);
adminRouter.patch(
  "/master-data/items/:itemId",
  requireAdminAction("master_data.write"),
  asyncHandler(AdminMasterDataController.updateItem)
);
adminRouter.get("/master-data/audits", asyncHandler(AdminMasterDataController.listAudits));

// Reports & Complaints (post + profile)
adminRouter.get("/reports", asyncHandler(AdminReportsController.listReports));
adminRouter.get("/reports/:kind/:id", asyncHandler(AdminReportsController.getReport));
adminRouter.post("/reports/:kind/:id/resolve", asyncHandler(AdminReportsController.resolveReport));
adminRouter.post("/reports/:kind/:id/dismiss", asyncHandler(AdminReportsController.dismissReport));
adminRouter.post(
  "/reports/:kind/:id/escalate",
  requireAdminAction("reports.escalate"),
  asyncHandler(AdminReportsController.escalateReport)
);
adminRouter.post(
  "/reports/:kind/:id/warn",
  requireAdminAction("reports.warn"),
  asyncHandler(AdminReportsController.warnFromReport)
);
adminRouter.post(
  "/reports/:kind/:id/suspend",
  requireAdminAction("reports.suspend"),
  asyncHandler(AdminReportsController.suspendFromReport)
);

// Settings & Roles
adminRouter.get("/settings", asyncHandler(AdminSettingsController.getSettings));
adminRouter.get("/settings/me", asyncHandler(AdminSettingsController.getMe));
adminRouter.put(
  "/settings/roles",
  requireAdminAction("settings.manage_roles"),
  asyncHandler(AdminSettingsController.setAdminRole)
);

// Platform Management
adminRouter.get("/platform/dashboard", asyncHandler(PlatformController.dashboard));
adminRouter.get("/platform/versions", asyncHandler(PlatformController.listVersions));
adminRouter.post("/platform/versions", asyncHandler(PlatformController.saveVersion));
adminRouter.get("/platform/maintenance", asyncHandler(PlatformController.getMaintenance));
adminRouter.put("/platform/maintenance", asyncHandler(PlatformController.updateMaintenance));
adminRouter.get("/platform/notifications", asyncHandler(PlatformController.listNotifications));
adminRouter.post("/platform/notifications", asyncHandler(PlatformController.createNotification));
adminRouter.post(
  "/platform/notifications/:id/send",
  asyncHandler(PlatformController.sendNotification)
);
adminRouter.post(
  "/platform/notifications/process-scheduled",
  asyncHandler(PlatformController.processScheduledNotifications)
);
adminRouter.get("/platform/popups", asyncHandler(PlatformController.listPopups));
adminRouter.post("/platform/popups", asyncHandler(PlatformController.savePopup));
adminRouter.get("/platform/announcements", asyncHandler(PlatformController.listAnnouncements));
adminRouter.post("/platform/announcements", asyncHandler(PlatformController.saveAnnouncement));
adminRouter.get("/platform/banners", asyncHandler(PlatformController.listBanners));
adminRouter.post("/platform/banners", asyncHandler(PlatformController.saveBanner));
adminRouter.get("/platform/features", asyncHandler(PlatformController.listFeatures));
adminRouter.patch("/platform/features/:code", asyncHandler(PlatformController.setFeature));
adminRouter.get("/platform/menu", asyncHandler(PlatformController.listMenu));
adminRouter.patch("/platform/menu/:code", asyncHandler(PlatformController.setMenu));
adminRouter.get("/platform/ads/analytics", asyncHandler(PlatformController.adAnalytics));
adminRouter.get("/platform/ads", asyncHandler(PlatformController.listAds));
adminRouter.post("/platform/ads", asyncHandler(PlatformController.saveAd));
adminRouter.get("/platform/audits", asyncHandler(PlatformController.listAudits));
