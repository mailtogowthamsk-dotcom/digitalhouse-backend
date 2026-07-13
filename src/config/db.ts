import { Sequelize } from "sequelize";
import "../config/env";

/** Remote MySQL (cPanel) needs longer timeouts + keep-alive; keep pool small for memory. */
const poolMax = Math.min(10, Math.max(2, Number(process.env.DB_POOL_MAX || 5)));
const connectTimeout = Math.max(5000, Number(process.env.DB_CONNECT_TIMEOUT_MS || 20000));

export const sequelize = new Sequelize(
  process.env.DB_NAME as string,
  process.env.DB_USER as string,
  process.env.DB_PASSWORD as string,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    logging: false,
    dialectOptions: {
      connectTimeout,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    },
    pool: {
      max: poolMax,
      min: 0,
      acquire: Math.max(30000, connectTimeout + 15000),
      idle: 10000,
      evict: 10000
    },
    retry: {
      max: 2,
      match: [
        /ETIMEDOUT/i,
        /ECONNRESET/i,
        /ECONNREFUSED/i,
        /SequelizeConnectionError/i,
        /SequelizeConnectionRefusedError/i,
        /SequelizeHostNotFoundError/i,
        /SequelizeConnectionTimedOutError/i,
        /Deadlock/i,
        /Lock wait timeout/i
      ]
    }
  }
);
