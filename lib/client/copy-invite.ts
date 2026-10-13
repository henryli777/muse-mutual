import type { InviteView } from "../domain.ts";
import type { Reservation } from "./api.ts";
export interface Pending {
  inviteId: string;
  operationId: string;
  expiresAt: number;
}
export interface CopyApi {
  reserve: (id: string, operationId: string) => Promise<Reservation>;
  confirm: (id: string) => Promise<{ invite: InviteView; counted: boolean }>;
  cancel: (id: string) => Promise<void>;
}
export interface CopyStorage {
  setItem: (key: string, value: string) => unknown;
  removeItem: (key: string) => unknown;
}
export interface CopyResult {
  status: "confirmed" | "pending" | "cancelled" | "needs_click" | "expired";
  invite?: InviteView;
  counted?: boolean;
  pending?: Pending;
  reservation?: Reservation;
  message?: string;
}
const key = (id: string) => "muse:pending:" + id;
function persist(storage: CopyStorage, pending: Pending) {
  try {
    storage.setItem(key(pending.operationId), JSON.stringify(pending));
  } catch {}
}
function remove(storage: CopyStorage, id: string) {
  try {
    storage.removeItem(key(id));
  } catch {}
}
export async function retryPending({
  pending,
  api,
  storage,
}: {
  pending: Pending;
  api: CopyApi;
  storage: CopyStorage;
}): Promise<CopyResult> {
  try {
    const out = await api.confirm(pending.operationId);
    remove(storage, pending.operationId);
    return { status: "confirmed", ...out };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status && status >= 400 && status < 500 && status !== 429) {
      remove(storage, pending.operationId);
      return {
        status: "expired",
        message:
          "已复制，预留已过期或不可确认，次数未同步，请以 MUSE 实际使用结果为准",
      };
    }
    persist(storage, pending);
    return {
      status: "pending",
      pending,
      message: "已复制，次数同步中。恢复网络后会重试。",
    };
  }
}
export async function copyInvite({
  inviteId,
  api,
  clipboard,
  storage,
  reservation: existing,
}: {
  inviteId: string;
  api: CopyApi;
  storage: CopyStorage;
  reservation?: Reservation;
  clipboard: {
    writeDeferred?: (code: Promise<string>) => Promise<void>;
    writeText?: (code: string) => Promise<void>;
  };
}): Promise<CopyResult> {
  const requestedId = existing?.operationId ?? crypto.randomUUID();
  const reserved = existing
    ? Promise.resolve(existing)
    : api.reserve(inviteId, requestedId);
  let reservation: Reservation;
  try {
    if (clipboard.writeDeferred) {
      await clipboard.writeDeferred(reserved.then((v) => v.code));
      reservation = await reserved;
    } else if (existing) {
      if (!clipboard.writeText)
        throw new Error("浏览器不支持剪贴板，请在支持剪贴板的浏览器中打开");
      const writing = clipboard.writeText(existing.code);
      await writing;
      reservation = existing;
    } else {
      reservation = await reserved;
      return {
        status: "needs_click",
        reservation,
        message: "名额已预留，请再点击一次复制。",
      };
    }
  } catch (e) {
    try {
      const r = await reserved;
      await api.cancel(r.operationId);
    } catch {}
    return {
      status: "cancelled",
      message: (e as Error).message || "复制未完成，未扣次数",
    };
  }
  const pending = {
    inviteId,
    operationId: reservation.operationId,
    expiresAt: reservation.expiresAt,
  };
  persist(storage, pending);
  return retryPending({ pending, api, storage });
}
