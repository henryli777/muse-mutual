import type { InviteView } from "../domain.ts";
import type { UsageFeedbackInput, RecordedUsageFeedback } from "./storage.ts";
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = (await r.json()) as T & {
    error?: { code: string; message: string };
  };
  if (!r.ok)
    throw new ApiError(
      r.status,
      v.error?.code ?? "error",
      v.error?.message ?? "操作失败，请稍后再试",
    );
  return v;
}
let ready: Promise<unknown> | undefined;
export function ensureSession() {
  if (!ready)
    ready = request("/api/session").catch((e) => {
      ready = undefined;
      throw e;
    });
  return ready;
}
export interface Reservation {
  operationId: string;
  code: string;
  expiresAt: number;
  alreadyCounted: boolean;
}
export const claimApi = {
  reserve: (inviteId: string, operationId: string) =>
    request<Reservation>("/api/claims", "POST", { inviteId, operationId }),
  confirm: (id: string) =>
    request<{ invite: InviteView; counted: boolean }>(
      "/api/claims/" + id,
      "PATCH",
      { action: "confirm" },
    ),
  cancel: async (id: string) => {
    await request("/api/claims/" + id, "PATCH", { action: "cancel" });
  },
};
export function submitUsageOutcome(
  operationId: string,
  feedback: UsageFeedbackInput,
) {
  return request<{ invite: InviteView; feedback: RecordedUsageFeedback }>(
    "/api/claims/" + operationId + "/outcome",
    "POST",
    feedback,
  );
}
