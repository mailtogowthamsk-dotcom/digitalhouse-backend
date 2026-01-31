import "./config/env";
import { app } from "./app";
import { sequelize } from "./config/db";
import { User, Otp, AdminVerification } from "./models";
import { seedOptionsIfEmpty } from "./seed/options.seed";

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  try {
    await sequelize.authenticate();
    // Use sync() without alter to avoid "Too many keys" on existing tables (MySQL limit 64 indexes).
    // New tables (e.g. post_reports) are still created; schema changes to existing tables need migrations.
    await sequelize.sync();
    await seedOptionsIfEmpty();
    if (!process.env.ADMIN_API_KEY) {
      console.warn("Warning: ADMIN_API_KEY is not set in .env — admin APIs will return 500.");
    }
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Digital House API running on http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("Failed to start server:", e);
    process.exit(1);
  }
}

start();
