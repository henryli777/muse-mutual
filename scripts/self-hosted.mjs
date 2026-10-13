import { fileURLToPath } from "node:url";
import { migrateDatabase } from "./self-hosted-migrations.mjs";
const mode = process.argv[2];
if (!["build", "start"].includes(mode))
  throw new Error("Expected build or start");
process.env.MUSE_BUILD_TARGET = "node";
if (mode === "start") {
  if (!process.env.MUSE_SESSION_SECRET || !process.env.MUSE_ADMIN_TOKEN)
    throw new Error("Self-hosted MUSE secrets are required");
  migrateDatabase(
    process.env.MUSE_DB_PATH,
    fileURLToPath(new URL("../drizzle", import.meta.url)),
  );
}
const cli = new URL("../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [
  process.execPath,
  fileURLToPath(cli),
  mode,
  ...process.argv.slice(3),
];
await import(cli.href);
