/**
 * Global test environment — runs before every test file.
 * Sets safe defaults so importing config/db or r2Client never hits production credentials.
 */
process.env.NODE_ENV = "test";
process.env.DB_POOL_PROFILE = "test";
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || "2";
process.env.DB_SLOW_QUERY_MS = "0";

// R2 / CDN — dummy values so modules that read env at import time don't throw
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "test-account";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "test-access-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "test-secret-key";
process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "test-bucket";
process.env.R2_CDN_PUBLIC_URL = process.env.R2_CDN_PUBLIC_URL || "https://cdn.test.local";

// JWT / app secrets used by middleware when controllers are exercised
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod";
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "test-admin-jwt-secret-different";
process.env.OTP_HASH_PEPPER = process.env.OTP_HASH_PEPPER || "test-otp-pepper";
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || "test-admin-api-key-16chars";

// Prefer dedicated test DB when present (integration suite)
if (!process.env.DB_NAME && process.env.TEST_DB_NAME) {
  process.env.DB_NAME = process.env.TEST_DB_NAME;
  process.env.DB_USER = process.env.TEST_DB_USER || process.env.DB_USER;
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD;
  process.env.DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || "127.0.0.1";
}

// Placeholder DB name so sequelize can construct without crashing unit tests that mock models
process.env.DB_NAME = process.env.DB_NAME || "digitalhouse_test";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
