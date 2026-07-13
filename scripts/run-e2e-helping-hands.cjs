/**
 * Runner: loads .env first, then executes e2e-helping-hands.ts via ts-node.
 * Usage: node scripts/run-e2e-helping-hands.cjs
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", esModuleInterop: true }
});
require("./e2e-helping-hands.ts");
