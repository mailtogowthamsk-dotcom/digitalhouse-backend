import "./config/env";
import os from "os";
import { app } from "./app";
import { sequelize } from "./config/db";
import { seedOptionsIfEmpty } from "./seed/options.seed";
import { setDbReady, setDbFailed } from "./state";

const PORT = Number(process.env.PORT) || 4000;

/** Get LAN IPv4 addresses (e.g. 192.168.x.x) for logging mobile API URL */
function getLocalIps(): string[] {
  const ips: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// Listen immediately so Railway gets a response (avoids "Application Failed to respond").
// DB init runs in background; API returns 503 until ready.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Digital House API listening on http://0.0.0.0:${PORT}`);
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
    await sequelize.sync();
    await seedOptionsIfEmpty();
    setDbReady(true);
    console.log("Database ready.");
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
