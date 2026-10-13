export type ReviewStatus = "normal" | "pending" | "invalid";
export type ReportReason = "expired" | "incorrect" | "other";
export type UsageOutcome = "success" | "failure";
export interface UsageFeedbackInput {
  outcome: UsageOutcome;
  reason?: ReportReason;
  note?: string;
}
export interface UsageFeedbackView {
  outcome: UsageOutcome;
  recordedAt: string;
}
export interface InviteView {
  id: string;
  code: string;
  nickname: string;
  remaining: number;
  available: number;
  copiedCount: number;
  createdAt: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
  reportCount: number;
  reportReasons: ReportReason[];
  lastVerifiedAt: string | null;
  successCount: number;
  failureCount: number;
}
export interface Submission {
  code: string;
  nickname: string;
  remaining: number;
}
export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function validateUsageFeedback(value: unknown): UsageFeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "invalid_input", "请选择使用结果");
  const v = value as Record<string, unknown>;
  if (v.outcome !== "success" && v.outcome !== "failure")
    throw new AppError(400, "invalid_outcome", "请选择使用成功或失败");
  if (v.reason !== undefined && !["expired", "incorrect", "other"].includes(v.reason as string))
    throw new AppError(400, "invalid_reason", "请选择反馈原因");
  if (v.note !== undefined && (typeof v.note !== "string" || v.note.length > 500))
    throw new AppError(400, "invalid_note", "补充说明最多500字");
  return {
    outcome: v.outcome,
    ...(v.outcome === "failure" ? {
      reason: (v.reason ?? "other") as ReportReason,
      note: (v.note as string | undefined)?.trim() ?? "",
    } : {}),
  };
}
export function validateRemaining(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 30
  )
    throw new AppError(400, "invalid_remaining", "剩余次数须为 0–30 的整数");
  return value;
}
export function validateSubmission(value: unknown): Submission {
  if (!value || typeof value !== "object")
    throw new AppError(400, "invalid_input", "请填写邀请码");
  const v = value as Record<string, unknown>;
  const code = typeof v.code === "string" ? v.code.trim() : "";
  if (!code || code.length > 200)
    throw new AppError(400, "invalid_code", "邀请码须为 1–200 个字符");
  if (v.nickname !== undefined && typeof v.nickname !== "string")
    throw new AppError(400, "invalid_nickname", "昵称须为文字");
  const nickname = (v.nickname as string | undefined)?.trim() ?? "";
  if (nickname.length > 40)
    throw new AppError(400, "invalid_nickname", "昵称最多 40 个字符");
  return {
    code,
    nickname,
    remaining: validateRemaining(v.remaining === undefined ? 30 : v.remaining),
  };
}
export function inviteStatus(
  v: Pick<InviteView, "remaining" | "reviewStatus">,
): "available" | "low" | "exhausted" | "pending" | "invalid" {
  if (v.reviewStatus === "invalid") return "invalid";
  if (v.remaining === 0) return "exhausted";
  if (v.reviewStatus === "pending") return "pending";
  return v.remaining <= 5 ? "low" : "available";
}
