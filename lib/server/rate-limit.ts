import { AppError } from "../domain.ts";
export async function rateLimit(
  db: D1Database,
  key: string,
  max: number,
  seconds: number,
) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits(key,window,count) VALUES(?,CAST(unixepoch('now')/? AS INTEGER)*?,1)
 ON CONFLICT(key,window) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`,
    )
    .bind(key, seconds, seconds, max)
    .first();
  if (!row) throw new AppError(429, "rate_limit", "操作过于频繁，请稍后再试");
  await db
    .prepare("DELETE FROM rate_limits WHERE window<unixepoch('now')-86400")
    .run();
}
