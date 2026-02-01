import "./config/env";
import { app } from "./app";
import { sequelize } from "./config/db";
import { seedOptionsIfEmpty } from "./seed/options.seed";
import { setDbReady, setDbFailed } from "./state";

const PORT = Number(process.env.PORT) || 4000;

// Listen immediately so Railway gets a response (avoids "Application Failed to respond").
// DB init runs in background; API returns 503 until ready.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Digital House API listening on http://0.0.0.0:${PORT}`);
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
    // Do NOT exit – keep server up so Railway gets 200 on /api/health and 503 on other routes.
    // Fix DB env vars (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) on Railway and redeploy.
  }
}
