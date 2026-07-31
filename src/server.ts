import "./config/env";
import os from "os";
import http from "http";
import { app } from "./app";
import { getApiMountPaths } from "./config/apiPath";
import { sequelize, initDbPoolInstrumentation } from "./config/db";
import { seedOptionsIfEmpty } from "./seed/options.seed";
import { masterDataService } from "./services/MasterData.service";
import { setDbReady, setDbFailed } from "./state";
import { initSocket, shutdownRealtime } from "./realtime/socket";
import { ensurePlatformDefaults } from "./services/Platform.service";
import * as SystemScheduler from "./services/SystemScheduler.service";
import { bootstrapAdminUsers } from "./services/AdminUsers.service";
import {
  startAllScheduledJobs,
  stopAllScheduledJobs
} from "./workers/schedulerRegistry";

const PORT = Number(process.env.PORT) || 4000;

/**
 * Jobs belong in digitalhouse-scheduler by default.
 * Set SCHEDULER_IN_API=true only for local single-process debugging.
 */
function schedulerInApiProcess(): boolean {
  return process.env.SCHEDULER_IN_API === "true";
}

/** Get LAN IPv4 addresses (e.g. 192.168.x.x) for logging mobile API URL */
function getLocalIps(): string[] {
  try {
    const ips: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
      }
    }
    return ips;
  } catch {
    return [];
  }
}

// Listen immediately so Railway gets a response (avoids "Application Failed to respond").
// Socket adapter (Redis) is attached before accept; DB init runs in background.
const httpServer = http.createServer(app);

void (async () => {
  try {
    await initSocket(httpServer);
  } catch (err) {
    console.error("[socket] init failed:", err);
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Digital House API listening on http://0.0.0.0:${PORT}`);
    console.log(
      "Health endpoints:",
      getApiMountPaths().map((m) => `http://127.0.0.1:${PORT}${m}/health`).join(", ")
    );
    if (process.env.API_BASE_PATH) {
      console.log(`API_BASE_PATH=${process.env.API_BASE_PATH}`);
    }
    const localIps = getLocalIps();
    if (localIps.length > 0) {
      console.log("For mobile app (same WiFi), set in mobile/.env:");
      localIps.forEach((ip) =>
        console.log(`  EXPO_PUBLIC_API_URL=http://${ip}:${PORT}/api`)
      );
    } else {
      console.log(
        "For mobile app: set EXPO_PUBLIC_API_URL in mobile/.env to http://<this-machine-IP>:" +
          PORT +
          "/api"
      );
    }
    initDb();
  });
})();

async function initDb() {
  try {
    await sequelize.authenticate();
    initDbPoolInstrumentation();
    // Prefer explicit SQL migrations in production. Sync invents schema from models.
    // Set DB_SYNC=true only when intentionally bootstrapping a fresh/dev schema.
    // Set DB_SYNC_ALTER=true only when you want Sequelize to ALTER tables (never in prod).
    const allowSync =
      process.env.DB_SYNC === "true" || process.env.NODE_ENV !== "production";
    if (allowSync) {
      const syncAlter = process.env.DB_SYNC_ALTER === "true";
      if (syncAlter && process.env.NODE_ENV === "production") {
        console.warn("Refusing DB_SYNC_ALTER=true in production (index duplication risk).");
        await sequelize.sync({});
      } else {
        await sequelize.sync(syncAlter ? { alter: true } : {});
      }
    } else {
      console.log("Skipping sequelize.sync (production). Use SQL migrations.");
    }
    await seedOptionsIfEmpty();
    await masterDataService.seedMasterDataIfNeeded();
    await ensurePlatformDefaults();
    try {
      const { legalService } = await import("./services/Legal.service");
      await legalService.ensureLegalDefaults();
    } catch (e) {
      console.warn("[startup] legal defaults failed:", e);
    }
    try {
      const PlanSettings = await import("./services/MatrimonyPlatformSettings.service");
      await PlanSettings.refreshPlanCatalogCache();
    } catch (e) {
      console.warn("[startup] subscription plan catalog cache warm failed:", e);
    }
    try {
      const BusinessSettings = await import("./services/BusinessSettings.service");
      await Promise.all([
        BusinessSettings.warmModuleCache("marketplace"),
        BusinessSettings.warmModuleCache("jobs"),
        BusinessSettings.warmModuleCache("subscriptions")
      ]);
    } catch (e) {
      console.warn("[startup] business settings cache warm failed:", e);
    }
    setDbReady(true);
    console.log("Database ready.");
    if (schedulerInApiProcess()) {
      console.warn(
        "[scheduler] SCHEDULER_IN_API=true — running interval jobs inside the API process (dev only)"
      );
      startAllScheduledJobs();
    } else {
      console.log(
        "[scheduler] interval jobs run in digitalhouse-scheduler worker (not in API)"
      );
    }
    void SystemScheduler.bootstrap().catch((e) =>
      console.warn("[system-scheduler] bootstrap failed:", e)
    );
    void bootstrapAdminUsers().catch((e) =>
      console.warn("[admin-users] bootstrap failed:", e)
    );
    if (!process.env.ADMIN_API_KEY) {
      console.warn("Warning: ADMIN_API_KEY is not set in .env — admin APIs will return 500.");
    } else {
      const { isWeakAdminApiKey } = await import("./middlewares/admin.middleware");
      if (isWeakAdminApiKey(process.env.ADMIN_API_KEY)) {
        console.warn(
          "Warning: ADMIN_API_KEY looks weak or is a placeholder — use a long random secret."
        );
      }
    }
    if (process.env.ADMIN_API_KEY_ROLE) {
      console.log(`[admin-auth] API key role = ${process.env.ADMIN_API_KEY_ROLE}`);
    }
    if (process.env.NODE_ENV !== "production") {
      try {
        const { warnIfAdminJwtSecretMissing } = await import("./utils/jwt.util");
        warnIfAdminJwtSecretMissing();
      } catch (e) {
        console.warn("[startup] admin JWT secret check failed:", e);
      }
      try {
        const { warnIfLegacyAdminPasswordConfigured } = await import("./services/admin.service");
        warnIfLegacyAdminPasswordConfigured();
      } catch (e) {
        console.warn("[startup] admin password deprecation check failed:", e);
      }
    }
    if (
      process.env.NODE_ENV === "production" &&
      process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "true"
    ) {
      console.warn(
        "[security] MATRIMONY_ALLOW_DEV_PAYMENTS=true is ignored in production (hard-blocked)."
      );
    }
  } catch (e) {
    console.error("Database init failed:", e);
    setDbFailed(true);
    // Do NOT exit – keep server up so Railway gets 200 on /health and 503 on other routes.
    // Fix DB env vars (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) on Railway and redeploy.
  }
}

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — closing HTTP + DB pool…`);
  if (schedulerInApiProcess()) {
    stopAllScheduledJobs();
  }
  await shutdownRealtime().catch((e) =>
    console.warn("[shutdown] realtime:", e)
  );
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    setTimeout(resolve, 5000);
  });
  try {
    await sequelize.close();
    console.log("[shutdown] DB pool closed");
  } catch (e) {
    console.warn("[shutdown] sequelize.close failed:", e);
  }
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
// ts-node-dev / crash paths — best-effort pool drain
process.on("beforeExit", () => {
  if (schedulerInApiProcess()) {
    stopAllScheduledJobs();
  }
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  void gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
