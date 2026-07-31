import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest — production test foundation for digital-house-backend.
 * CommonJS sources under src/ are loaded via Vite's Node transform.
 */
export default defineConfig({
  test: {
    name: "digital-house-backend",
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup/env.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "scripts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts",
        "src/workers/**",
        "src/seed/**",
        "src/**/*.d.ts",
        "**/node_modules/**",
        "**/dist/**"
      ],
      thresholds: {
        // Foundation floors — raise as the suite grows (see tests/README.md).
        lines: 2,
        functions: 30,
        branches: 30,
        statements: 2
      }
    },
    sequence: {
      shuffle: false
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
