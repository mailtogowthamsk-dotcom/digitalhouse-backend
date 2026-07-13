import "./config/env";
import os from "os";
import http from "http";
import { app } from "./app";
import { getApiMountPaths } from "./config/apiPath";
import { sequelize } from "./config/db";
import { seedOptionsIfEmpty } from "./seed/options.seed";
import { masterDataService } from "./services/MasterData.service";
import { setDbReady, setDbFailed } from "./state";
import { initSocket } from "./realtime/socket";
import { startMatrimonySubscriptionJobs } from "./services/MatrimonySubscriptionLifecycle.service";
import { startMarketplaceExpiryJobs } from "./services/MarketplaceExpiry.service";
import { ensurePlatformDefaults, startPlatformNotificationJobs } from "./services/Platform.service";

const PORT = Number(process.env.PORT) || 4000;

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
// DB init runs in background; API returns 503 until ready.
const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Digital House API listening on http://0.0.0.0:${PORT}`);
  console.log("Health endpoints:", getApiMountPaths().map((m) => `http://127.0.0.1:${PORT}${m}/health`).join(", "));
  if (process.env.API_BASE_PATH) {
    console.log(`API_BASE_PATH=${process.env.API_BASE_PATH}`);
  }
  const localIps = getLocalIps();
  if (localIps.length > 0) {
    console.log("For mobile app (same WiFi), set in mobile/.env:");
    localIps.forEach((ip) => console.log(`  EXPO_PUBLIC_API_URL=http://${ip}:${PORT}/api`));
  } else {
    console.log("For mobile app: set EXPO_PUBLIC_API_URL in mobile/.env to http://<this-machine-IP>:" + PORT + "/api");
  }
  initDb();
});

async function initDb() {
  try {
    await sequelize.authenticate();
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
    }    await seedOptionsIfEmpty();
    await masterDataService.seedMasterDataIfNeeded();
    await ensurePlatformDefaults();
    setDbReady(true);
    console.log("Database ready.");
    startMatrimonySubscriptionJobs();
    startMarketplaceExpiryJobs();
    startPlatformNotificationJobs();
    if (!process.env.ADMIN_API_KEY) {
      console.warn("Warning: ADMIN_API_KEY is not set in .env — admin APIs will return 500.");
    }
  } catch (e) {
    console.error("Database init failed:", e);
    setDbFailed(true);
    // Do NOT exit – keep server up so Railway gets 200 on /health and 503 on other routes.
    // Fix DB env vars (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) on Railway and redeploy.
  }
}
