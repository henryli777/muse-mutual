import { AppError, validateSubmission, validateRemaining } from "../domain.ts";
import type {
  InviteView,
  Submission,
  ReportReason,
  ReviewStatus,
} from "../domain.ts";
type Row = Record<string, any>;
export const ACTIVE = `(SELECT count(*) FROM claims c WHERE c.invite_id=i.id AND c.status='reserved' AND c.copy_revision=i.copy_revision AND c.expires_at>unixepoch('now'))`;
const SELECT = `SELECT i.id,i.code,i.nickname,i.remaining,i.copied_count,i.created_at,i.updated_at,i.review_status,
 i.remaining-${ACTIVE} AS available,
 (SELECT count(*) FROM reports r WHERE r.invite_id=i.id AND r.resolved=0) AS report_count,
 (SELECT group_concat(DISTINCT reason) FROM reports r WHERE r.invite_id=i.id AND r.resolved=0) AS report_reasons FROM invites i`;
function view(r: Row): InviteView {
  return {
    id: r.id,
    code: r.code,
    nickname: r.nickname,
    remaining: r.remaining,
    available: r.available,
    copiedCount: r.copied_count,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
    reviewStatus: r.review_status as ReviewStatus,
    reportCount: r.report_count,
    reportReasons: r.report_reasons
      ? (r.report_reasons.split(",") as ReportReason[])
      : [],
  };
}
export async function getInvite(
  db: D1Database,
  id: string,
): Promise<InviteView> {
  const r = await db
    .prepare(SELECT + " WHERE i.id=?")
    .bind(id)
    .first<Row>();
  if (!r) throw new AppError(404, "not_found", "找不到这个邀请码");
  return view(r);
}
export async function createInvite(
  db: D1Database,
  input: Submission,
  ownerHash: string,
  now: number,
): Promise<InviteView> {
  const v = validateSubmission(input),
    id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO invites(id,code,nickname,initial_remaining,remaining,owner_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        v.code,
        v.nickname,
        v.remaining,
        v.remaining,
        ownerHash,
        now,
        now,
      )
      .run();
  } catch (e) {
    if (
      String(e).includes("UNIQUE") ||
      String((e as any)?.cause).includes("UNIQUE")
    )
      throw new AppError(
        409,
        "duplicate_code",
        "这个邀请码已分享，请使用原有记录",
      );
    throw e;
  }
  return getInvite(db, id);
}
export async function listInvites(
  db: D1Database,
  options: { sort?: string; filter?: string; limit?: number } = {},
): Promise<InviteView[]> {
  const conditions: { [k: string]: string } = {
    available: "i.remaining>0 AND i.review_status!='invalid'",
    pending: "i.review_status='pending'",
    exhausted: "i.remaining=0",
    all: "1=1",
  };
  const filter =
    conditions[options.filter ?? "available"] ?? conditions.available;
  const order =
    options.sort === "remaining"
      ? "i.remaining DESC,i.created_at DESC"
      : "CASE WHEN i.review_status='normal' THEN 0 ELSE 1 END,i.created_at DESC";
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 200)));
  const { results } = await db
    .prepare(
      SELECT + " WHERE " + filter + " ORDER BY " + order + ",i.id DESC LIMIT ?",
    )
    .bind(limit)
    .all<Row>();
  return results.map(view);
}
export async function updateRemaining(
  db: D1Database,
  id: string,
  ownerHash: string,
  remaining: number,
  now: number,
): Promise<InviteView> {
  validateRemaining(remaining);
  const result = await db
    .prepare(
      `UPDATE invites AS i SET remaining=?,updated_at=? WHERE id=? AND owner_hash=? AND ?>=${ACTIVE}`,
    )
    .bind(remaining, now, id, ownerHash, remaining)
    .run();
  if (!result.meta.changes) {
    const row = await db
      .prepare("SELECT owner_hash FROM invites WHERE id=?")
      .bind(id)
      .first<Row>();
    if (!row) throw new AppError(404, "not_found", "找不到这个邀请码");
    if (row.owner_hash !== ownerHash)
      throw new AppError(403, "wrong_owner", "管理凭据不正确");
    throw new AppError(
      409,
      "active_reservations",
      "有人正在复制，不能将次数设为少于预留名额，请稍后再试",
    );
  }
  return getInvite(db, id);
}
