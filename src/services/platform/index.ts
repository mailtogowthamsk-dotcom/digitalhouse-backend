export {
  ensurePlatformDefaults,
  listFeatureFlags,
  setFeatureFlag,
  listMenuItems,
  setMenuItem
} from "./platform-setup.service";

export {
  getMaintenanceAdmin,
  updateMaintenance,
  resolveMaintenance
} from "./maintenance.service";

export {
  listVersions,
  upsertVersion,
  versionPolicyFor
} from "./versions.service";

export { getPlatformBootstrap } from "./bootstrap.service";

export {
  acknowledgePopup,
  trackAdEvent,
  listPopups,
  savePopup,
  listAnnouncements,
  saveAnnouncement,
  listBanners,
  saveBanner,
  listAds,
  saveAd,
  getAdAnalytics
} from "./marketing-content.service";

export {
  listPlatformNotifications,
  createPlatformNotification,
  sendPlatformNotification,
  getPlatformNotificationJobRuntimeStatus,
  processScheduledPlatformNotifications,
  startPlatformNotificationJobs,
  stopPlatformNotificationJobs
} from "./notifications.service";

export { getAdminDashboard, listAuditLogs } from "./admin.service";
