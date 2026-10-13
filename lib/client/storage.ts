import type { Pending } from "./copy-invite";
import type { ReportReason } from "../domain.ts";
const memory = new Map<string, string>();
export const storage = {
  getItem(key: string) {
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  removeItem(key: string) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  sync(key: string, value: string | null) {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  },
};
export function pendingOperations(): Pending[] {
  const keys = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.add(k);
    }
  } catch {}
  const out: Pending[] = [];
  for (const key of keys) {
    if (!key.startsWith("muse:pending:")) continue;
    try {
      const v = JSON.parse(storage.getItem(key) ?? "null");
      if (
        v &&
        typeof v.operationId === "string" &&
        typeof v.inviteId === "string"
      )
        out.push(v);
    } catch {}
  }
  return out;
}
export function ownerTokens(): Record<string, string> {
  try {
    return JSON.parse(storage.getItem("muse:owners") ?? "{}");
  } catch {
    return {};
  }
}

export type UsageOutcome = "success" | "failure";
export interface UsageFeedbackInput {
  outcome: UsageOutcome;
  reason?: ReportReason;
  note?: string;
}
export interface RecordedUsageFeedback {
  outcome: UsageOutcome;
  recordedAt: string;
}
export interface ConfirmedOperation {
  inviteId: string;
  operationId: string;
  confirmedAt: string;
  pendingFeedback?: UsageFeedbackInput;
  feedback?: RecordedUsageFeedback;
}
const confirmedKey = (id: string) => "muse:confirmed:" + id;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const feedbackWindow = 7 * 86400000;
function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function validFeedback(value: unknown): value is UsageFeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.outcome === "success") return v.reason === undefined && v.note === undefined;
  return v.outcome === "failure" &&
    (v.reason === "expired" || v.reason === "incorrect" || v.reason === "other") &&
    (v.note === undefined || (typeof v.note === "string" && v.note.length <= 500));
}
function validOperation(value: unknown, inviteId: string, now: number): value is ConfirmedOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.inviteId !== inviteId || !uuid.test(inviteId) ||
    typeof v.operationId !== "string" || !uuid.test(v.operationId) ||
    !validTimestamp(v.confirmedAt)) return false;
  const age = now - Date.parse(v.confirmedAt);
  if (age < 0 || age > feedbackWindow) return false;
  if (v.pendingFeedback !== undefined && !validFeedback(v.pendingFeedback)) return false;
  if (v.feedback !== undefined) {
    const f = v.feedback as Record<string, unknown> | null;
    if (!f || (f.outcome !== "success" && f.outcome !== "failure") || !validTimestamp(f.recordedAt)) return false;
  }
  return true;
}
function writeConfirmed(record: ConfirmedOperation) {
  storage.setItem(confirmedKey(record.inviteId), JSON.stringify(record));
  return record;
}
export function confirmedOperations(now = Date.now()): Record<string, ConfirmedOperation> {
  const keys = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.add(key);
    }
  } catch {}
  const out: Record<string, ConfirmedOperation> = {};
  for (const key of keys) {
    if (!key.startsWith("muse:confirmed:")) continue;
    const inviteId = key.slice("muse:confirmed:".length);
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
      if (validOperation(value, inviteId, now)) {
        out[inviteId] = value;
        continue;
      }
    } catch {}
    storage.removeItem(key);
  }
  return out;
}
export function rememberConfirmedOperation(inviteId: string, operationId: string, now = Date.now()): ConfirmedOperation {
  const previous = confirmedOperations(now)[inviteId];
  if (previous?.operationId === operationId) return previous;
  const record = { inviteId, operationId, confirmedAt: new Date(now).toISOString() };
  return writeConfirmed(record);
}
export function queueUsageFeedback(record: ConfirmedOperation, input: UsageFeedbackInput, now = Date.now()): ConfirmedOperation {
  const current = confirmedOperations(now)[record.inviteId];
  if (!current || current.operationId !== record.operationId) throw new Error("这次领取已超过反馈期限，请重新复制领取后反馈。");
  if (current.feedback || current.pendingFeedback) return current;
  return writeConfirmed({ ...current, pendingFeedback: input });
}
export function recordUsageFeedback(inviteId: string, operationId: string, feedback: RecordedUsageFeedback, now = Date.now()): ConfirmedOperation | undefined {
  const current = confirmedOperations(now)[inviteId];
  if (!current || current.operationId !== operationId) return;
  const record = { ...current, feedback };
  delete record.pendingFeedback;
  return writeConfirmed(record);
}
export function expireConfirmedOperation(inviteId: string, operationId: string, now = Date.now()) {
  if (confirmedOperations(now)[inviteId]?.operationId === operationId) storage.removeItem(confirmedKey(inviteId));
}
