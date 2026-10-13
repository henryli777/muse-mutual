import { AppError } from "../domain.ts";
import { ACTIVE, getInvite } from "./invite-repository.ts";
type Op = Record<string, any>;
const OP_SELECT = `SELECT c.*,i.code,i.review_status,i.copy_revision AS current_revision,i.remaining,unixepoch('now') AS db_now FROM claims c JOIN invites i ON i.id=c.invite_id`;
async function operation(db: D1Database, id: string) {
  return db
    .prepare(OP_SELECT + " WHERE c.operation_id=?")
    .bind(id)
    .first<Op>();
}
function owned(row: Op | null, visitor: string) {
  if (!row) throw new AppError(404, "not_found", "找不到这次领取");
  if (row.visitor_hash !== visitor)
    throw new AppError(403, "wrong_visitor", "领取访客不匹配");
  return row;
}
function reservation(row: Op) {
  if (
    row.status !== "confirmed" &&
    (row.status !== "reserved" ||
      row.expires_at <= row.db_now ||
      row.copy_revision !== row.current_revision ||
      row.review_status === "invalid")
  )
    throw new AppError(
      409,
      "claim_expired",
      "预留已过期、取消或邀请码已失效，请刷新列表",
    );
  return {
    operationId: row.operation_id as string,
    code: row.code as string,
    expiresAt: row.expires_at as number,
    alreadyCounted: row.status === "confirmed",
  };
}
export async function reserveClaim(
  db: D1Database,
  input: { inviteId: string; operationId: string; visitorHash: string },
) {
  const { inviteId, operationId, visitorHash } = input;
  if (
    !/^[a-f0-9-]{36}$/i.test(operationId) ||
    typeof inviteId !== "string" ||
    inviteId.length > 60
  )
    throw new AppError(400, "invalid_operation", "领取参数不正确");
  const previous = await operation(db, operationId);
  if (previous) {
    const p = owned(previous, visitorHash);
    if (p.invite_id !== inviteId)
      throw new AppError(409, "operation_conflict", "领取操作不能更换邀请码");
    return reservation(p);
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO claims(operation_id,invite_id,visitor_hash,copy_revision,status,created_at,expires_at)
 SELECT ?,i.id,?,i.copy_revision,'reserved',unixepoch('now'),unixepoch('now')+90 FROM invites i
 WHERE i.id=? AND i.review_status!='invalid' AND i.remaining>${ACTIVE}
 AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.invite_id=i.id AND c.visitor_hash=? AND
 ((c.status='reserved' AND c.copy_revision=i.copy_revision AND c.expires_at>unixepoch('now')) OR (c.status='confirmed' AND c.confirmed_at>unixepoch('now')-600)))`,
    )
    .bind(operationId, visitorHash, inviteId, visitorHash)
    .run();
  const inserted = await operation(db, operationId);
  if (inserted) {
    const p = owned(inserted, visitorHash);
    if (p.invite_id !== inviteId)
      throw new AppError(409, "operation_conflict", "领取操作不能更换邀请码");
    return reservation(p);
  }
  const invite = await getInvite(db, inviteId);
  if (invite.reviewStatus === "invalid" || invite.remaining === 0)
    throw new AppError(409, "unavailable", "这个邀请码已用完或失效");
  const recent = await db
    .prepare(
      OP_SELECT +
        ` WHERE c.invite_id=? AND c.visitor_hash=? AND
 ((c.status='reserved' AND c.copy_revision=i.copy_revision AND c.expires_at>unixepoch('now')) OR (c.status='confirmed' AND c.confirmed_at>unixepoch('now')-600)) ORDER BY c.created_at DESC LIMIT 1`,
    )
    .bind(inviteId, visitorHash)
    .first<Op>();
  if (recent?.status === "reserved")
    throw new AppError(
      409,
      "claim_in_progress",
      "这个邀请码已有复制操作进行中，请完成该操作后重试",
    );
  if (recent) return reservation(recent);
  throw new AppError(409, "unavailable", "名额已被其他人预留，请稍后刷新");
}
export async function confirmClaim(
  db: D1Database,
  id: string,
  visitorHash: string,
) {
  owned(await operation(db, id), visitorHash);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE claims SET status='confirming' WHERE operation_id=? AND visitor_hash=? AND status='reserved'
 AND expires_at>unixepoch('now') AND EXISTS(SELECT 1 FROM invites i WHERE i.id=claims.invite_id AND i.review_status!='invalid' AND i.copy_revision=claims.copy_revision)`,
      )
      .bind(id, visitorHash),
    db
      .prepare(
        `UPDATE invites SET remaining=remaining-1,copied_count=copied_count+1 WHERE id=(SELECT invite_id FROM claims WHERE operation_id=? AND visitor_hash=? AND status='confirming')`,
      )
      .bind(id, visitorHash),
    db
      .prepare(
        "UPDATE claims SET status='confirmed',confirmed_at=unixepoch('now') WHERE operation_id=? AND visitor_hash=? AND status='confirming'",
      )
      .bind(id, visitorHash),
  ]);
  const row = owned(await operation(db, id), visitorHash);
  if (row.status !== "confirmed")
    throw new AppError(
      409,
      "claim_expired",
      "预留已过期、取消或邀请码已失效，次数未同步",
    );
  return {
    invite: await getInvite(db, row.invite_id),
    counted: results[0].meta.changes === 1,
  };
}
export async function cancelClaim(
  db: D1Database,
  id: string,
  visitorHash: string,
) {
  owned(await operation(db, id), visitorHash);
  await db
    .prepare(
      "UPDATE claims SET status='cancelled' WHERE operation_id=? AND visitor_hash=? AND status='reserved'",
    )
    .bind(id, visitorHash)
    .run();
}
