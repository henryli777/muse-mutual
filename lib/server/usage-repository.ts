import { AppError, validateUsageFeedback } from "../domain.ts";
import type { InviteView, UsageFeedbackView, UsageOutcome } from "../domain.ts";
import { getInvite } from "./invite-repository.ts";

interface ClaimFeedbackRow {
  invite_id: string;
  visitor_hash: string;
  status: string;
  confirmed_at: number | null;
  copy_revision: number;
  current_revision: number;
  review_status: string;
  db_now: number;
  outcome: UsageOutcome | null;
  recorded_at: number | null;
}

async function claimFeedback(db: D1Database, operationId: string) {
  return db.prepare(`SELECT c.invite_id,c.visitor_hash,c.status,c.confirmed_at,c.copy_revision,
 i.copy_revision AS current_revision,i.review_status,unixepoch('now') AS db_now,f.outcome,f.recorded_at
 FROM claims c JOIN invites i ON i.id=c.invite_id
 LEFT JOIN usage_feedback f ON f.operation_id=c.operation_id WHERE c.operation_id=?`)
    .bind(operationId).first<ClaimFeedbackRow>();
}

function eligible(row: ClaimFeedbackRow | null, visitorHash: string) {
  if (!row) throw new AppError(404, "not_found", "找不到这次领取");
  if (row.visitor_hash !== visitorHash)
    throw new AppError(403, "wrong_visitor", "领取访客不匹配");
  if (row.status !== "confirmed" || row.confirmed_at === null ||
      row.confirmed_at < row.db_now - 604800 || row.confirmed_at > row.db_now ||
      row.copy_revision !== row.current_revision || row.review_status === "invalid")
    throw new AppError(409, "feedback_unavailable", "只能反馈七天内已复制且仍有效的记录，请刷新列表");
  return row;
}

async function result(db: D1Database, row: ClaimFeedbackRow, outcome: UsageOutcome) {
  if (!row.outcome || row.recorded_at === null)
    throw new AppError(409, "feedback_unavailable", "领取记录已变化，请刷新列表");
  if (row.outcome !== outcome)
    throw new AppError(409, "outcome_conflict", "这次领取已经反馈，不能更换使用结果");
  return {
    invite: await getInvite(db, row.invite_id),
    feedback: { outcome: row.outcome, recordedAt: new Date(row.recorded_at * 1000).toISOString() },
  };
}

export async function submitUsageFeedback(
  db: D1Database,
  operationId: string,
  visitorHash: string,
  input: unknown,
): Promise<{ invite: InviteView; feedback: UsageFeedbackView }> {
  const value = validateUsageFeedback(input);
  const previous = eligible(await claimFeedback(db, operationId), visitorHash);
  if (previous.outcome) return result(db, previous, value.outcome);

  // Gate report side effects on this attempt's random ID, so concurrent retries
  // and retries after moderation cannot resubmit an existing feedback's report.
  const feedbackId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO usage_feedback(id,operation_id,invite_id,copy_revision,outcome,recorded_at)
 SELECT ?,c.operation_id,c.invite_id,c.copy_revision,?,unixepoch('now') FROM claims c JOIN invites i ON i.id=c.invite_id
 WHERE c.operation_id=? AND c.visitor_hash=? AND c.status='confirmed'
 AND c.confirmed_at BETWEEN unixepoch('now')-604800 AND unixepoch('now')
 AND c.copy_revision=i.copy_revision AND i.review_status!='invalid'`)
      .bind(feedbackId, value.outcome, operationId, visitorHash),
    db.prepare(`INSERT INTO reports(id,invite_id,visitor_hash,reason,note,created_at,resolved)
 SELECT ?,f.invite_id,c.visitor_hash,?,?,f.recorded_at,0
 FROM usage_feedback f JOIN claims c ON c.operation_id=f.operation_id WHERE f.id=? AND f.outcome='failure'
 ON CONFLICT(invite_id,visitor_hash) DO UPDATE SET reason=excluded.reason,note=excluded.note,
 created_at=excluded.created_at,resolved=0 WHERE reports.resolved=1`)
      .bind(crypto.randomUUID(), value.reason ?? "other", value.note ?? "", feedbackId),
    db.prepare(`UPDATE invites SET review_status='pending'
 WHERE id=(SELECT invite_id FROM usage_feedback WHERE id=? AND outcome='failure')
 AND review_status!='invalid' AND EXISTS(SELECT 1 FROM reports WHERE invite_id=invites.id AND resolved=0)`)
      .bind(feedbackId),
  ]);
  return result(db, eligible(await claimFeedback(db, operationId), visitorHash), value.outcome);
}
