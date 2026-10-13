// Included only by the self-hosted build. Worker builds keep their native bindings.
import { openSqliteD1 } from "./sqlite-d1";
let database: ReturnType<typeof openSqliteD1> | undefined;
export const env = {
  get DB(): D1Database {
    const path = process.env.MUSE_DB_PATH;
    if (!path)
      throw new Error("MUSE_DB_PATH is required for the self-hosted server");
    database ??= openSqliteD1(path);
    return database.db;
  },
  get MUSE_SESSION_SECRET() {
    return process.env.MUSE_SESSION_SECRET;
  },
  get MUSE_ADMIN_TOKEN() {
    return process.env.MUSE_ADMIN_TOKEN;
  },
  get MUSE_CANONICAL_ORIGIN() {
    return process.env.MUSE_CANONICAL_ORIGIN;
  },
};
