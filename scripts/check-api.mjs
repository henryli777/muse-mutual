import assert from "node:assert/strict";
const origin = process.argv[2] ?? "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("This test only runs against a local preview database.");
async function visitor() {
  const r = await fetch(origin + "/api/session");
  assert.equal(r.status, 200);
  return r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
async function api(path, cookie, method = "GET", body, extra = {}) {
  const r = await fetch(origin + path, {
    method,
    headers: { origin, cookie, "content-type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const owner = await visitor();
const shared = await api("/api/invites", owner, "POST", {
  code: "LOCAL-TEST-" + crypto.randomUUID(),
  remaining: 1,
  nickname: "本地并发测试",
});
assert.equal(shared.status, 201, JSON.stringify(shared.body));
const id = shared.body.invite.id;
const cookies = await Promise.all(Array.from({ length: 20 }, () => visitor()));
const attempts = await Promise.all(
  cookies.map(async (cookie) => ({
    cookie,
    ...(await api("/api/claims", cookie, "POST", {
      inviteId: id,
      operationId: crypto.randomUUID(),
    })),
  })),
);
const winners = attempts.filter((r) => r.status === 200);
assert.equal(winners.length, 1);
const winner = winners[0];
const confirms = await Promise.all(
  Array.from({ length: 10 }, () =>
    api("/api/claims/" + winner.body.operationId, winner.cookie, "PATCH", {
      action: "confirm",
    }),
  ),
);
assert.equal(confirms.filter((r) => r.body.counted === true).length, 1);
for (const r of confirms) assert.equal(r.status, 200);
const stored = await api("/api/invites?filter=all", owner);
const invite = stored.body.invites.find((v) => v.id === id);
assert.equal(invite.remaining, 0);
assert.equal(invite.copiedCount, 1);
const denied = await api(
  "/api/invites/" + id,
  cookies[1],
  "PATCH",
  { remaining: 30 },
  { "X-Owner-Token": "wrong" },
);
assert.equal(denied.status, 403);
const edited = await api(
  "/api/invites/" + id,
  owner,
  "PATCH",
  { remaining: 2 },
  { "X-Owner-Token": shared.body.ownerToken },
);
assert.equal(edited.status, 200);
assert.equal(edited.body.invite.remaining, 2);
console.log(
  "Local Worker API verified: 20 contenders, 1 reservation; 10 confirms, 1 decrement; owner authorization enforced.",
);

const reported = await api("/api/reports", cookies[1], "POST", {
  inviteId: id,
  reason: "incorrect",
  note: "LOCAL-TEST private note",
});
assert.equal(reported.status, 200);
assert.equal(reported.body.invite.reviewStatus, "pending");
assert.equal((await api("/api/admin/reports", owner)).status, 401);
const { readFileSync } = await import("node:fs");
const token = readFileSync(".dev.vars", "utf8")
  .split("\n")
  .find((v) => v.startsWith("MUSE_ADMIN_TOKEN="))
  .slice(17);
const login = await fetch(origin + "/api/admin/session", {
  method: "POST",
  headers: { origin, cookie: owner, "content-type": "application/json" },
  body: JSON.stringify({ token }),
});
assert.equal(login.status, 200);
const admin =
  owner +
  "; " +
  login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
const queue = await api("/api/admin/reports", admin);
assert.equal(queue.status, 200);
assert.ok(
  queue.body.reports.some(
    (v) => v.inviteId === id && v.note === "LOCAL-TEST private note",
  ),
);
const invalid = await api("/api/admin/invites/" + id, admin, "PATCH", {
  action: "invalidate",
});
assert.equal(invalid.body.invite.reviewStatus, "invalid");
const restored = await api("/api/admin/invites/" + id, admin, "PATCH", {
  action: "restore",
});
assert.equal(restored.body.invite.remaining, 2);
assert.equal(restored.body.invite.reportCount, 0);
console.log(
  "Local moderation verified: pending feedback, private notes, anonymous denial, admin invalidation and restoration.",
);
