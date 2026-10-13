import type { Pending } from "./copy-invite";
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
