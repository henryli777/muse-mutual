import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/sqlite-d1.ts";
import { createInvite, getInvite } from "../lib/server/invite-repository.ts";
import {
  reserveClaim,
  confirmClaim,
  cancelClaim,
} from "../lib/server/claim-repository.ts";
import { copyInvite, retryPending } from "../lib/client/copy-invite.ts";
async function setup() {
  const f = fixture();
  const invite = await createInvite(
    f.db,
    { code: "copy-code", nickname: "", remaining: 3 },
    "o",
    f.now(),
  );
  const data = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => data.set(k, v),
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => data.delete(k),
  };
  const api = {
    reserve: (id: string, operationId: string) =>
      reserveClaim(f.db, { inviteId: id, operationId, visitorHash: "v" }),
    confirm: (operationId: string) => confirmClaim(f.db, operationId, "v"),
    cancel: (operationId: string) => cancelClaim(f.db, operationId, "v"),
  };
  return { ...f, invite, api, data, storage };
}
test("clipboard_failure_cancels and never consumes quota", async () => {
  const f = await setup();
  const result = await copyInvite({
    inviteId: f.invite.id,
    api: f.api,
    storage: f.storage,
    clipboard: {
      writeDeferred: async (code: Promise<string>) => {
        await code;
        throw new Error("clipboard denied");
      },
    },
  });
  assert.equal(result.status, "cancelled");
  const v = await getInvite(f.db, f.invite.id);
  assert.equal(v.remaining, 3);
  assert.equal(v.available, 3);
});
test("confirmation_network_failure_stays_pending and retry uses the same operation", async () => {
  const f = await setup();
  let offline = true;
  const api = {
    ...f.api,
    confirm: async (id: string) => {
      if (offline) throw new TypeError("offline");
      return f.api.confirm(id);
    },
  };
  const result = await copyInvite({
    inviteId: f.invite.id,
    api,
    storage: f.storage,
    clipboard: {
      writeDeferred: async (code: Promise<string>) => {
        assert.equal(await code, "copy-code");
      },
    },
  });
  assert.equal(result.status, "pending");
  assert.equal(f.data.size, 1);
  offline = false;
  assert.ok(result.pending);
  const retried = await retryPending({
    pending: result.pending,
    api,
    storage: f.storage,
  });
  assert.equal(retried.status, "confirmed");
  assert.equal(f.data.size, 0);
  assert.equal((await getInvite(f.db, f.invite.id)).remaining, 2);
});
test("expired_pending_does_not_retry_new_claim or debit a new slot", async () => {
  const f = await setup();
  const api = {
    ...f.api,
    confirm: async () => {
      throw new TypeError("offline");
    },
  };
  const result = await copyInvite({
    inviteId: f.invite.id,
    api,
    storage: f.storage,
    clipboard: {
      writeDeferred: async (code: Promise<string>) => {
        await code;
      },
    },
  });
  f.advance(91);
  assert.ok(result.pending);
  const retry = await retryPending({
    pending: result.pending,
    api: f.api,
    storage: f.storage,
  });
  assert.equal(retry.status, "expired");
  assert.equal(f.data.size, 0);
  assert.equal((await getInvite(f.db, f.invite.id)).remaining, 3);
});
test("two_tabs_same_cookie copies without a second deduction", async () => {
  const f = await setup();
  const opts = {
    inviteId: f.invite.id,
    api: f.api,
    storage: f.storage,
    clipboard: {
      writeDeferred: async (code: Promise<string>) => {
        await code;
      },
    },
  };
  await copyInvite(opts);
  const second = await copyInvite(opts);
  assert.equal(second.status, "confirmed");
  assert.equal(second.counted, false);
  assert.equal((await getInvite(f.db, f.invite.id)).copiedCount, 1);
});
test("fallback waits for another user click before copying or confirming", async () => {
  const f = await setup();
  let copied = "";
  const clipboard = {
    writeText: async (code: string) => {
      copied = code;
    },
  };
  const first = await copyInvite({
    inviteId: f.invite.id,
    api: f.api,
    storage: f.storage,
    clipboard,
  });
  assert.equal(first.status, "needs_click");
  assert.equal(copied, "");
  assert.equal((await getInvite(f.db, f.invite.id)).remaining, 3);
  const second = await copyInvite({
    inviteId: f.invite.id,
    api: f.api,
    storage: f.storage,
    clipboard,
    reservation: first.reservation,
  });
  assert.equal(second.status, "confirmed");
  assert.equal(copied, "copy-code");
  assert.equal((await getInvite(f.db, f.invite.id)).remaining, 2);
});

test("fallback calls clipboard during the click before the first await", async () => {
  const f = await setup();
  const reservation = await f.api.reserve(f.invite.id, crypto.randomUUID());
  let started = false;
  const work = copyInvite({
    inviteId: f.invite.id,
    api: f.api,
    storage: f.storage,
    reservation,
    clipboard: {
      writeText: async () => {
        started = true;
      },
    },
  });
  assert.equal(started, true);
  await work;
});
