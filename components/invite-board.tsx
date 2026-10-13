"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal,
  Gift,
  ShieldCheck,
  HeartHandshake,
} from "lucide-react";
import type { InviteView } from "@/lib/domain";
import {
  ensureSession,
  request,
  claimApi,
  submitUsageOutcome,
  ApiError,
} from "@/lib/client/api";
import type { Reservation } from "@/lib/client/api";
import { copyInvite, retryPending } from "@/lib/client/copy-invite";
import type { CopyResult, Pending } from "@/lib/client/copy-invite";
import {
  storage,
  ownerTokens,
  pendingOperations,
  confirmedOperations,
  rememberConfirmedOperation,
  queueUsageFeedback,
  recordUsageFeedback,
  expireConfirmedOperation,
} from "@/lib/client/storage";
import type { ConfirmedOperation, UsageFeedbackInput } from "@/lib/client/storage";
import ShareForm from "./share-form";
import InviteCard from "./invite-card";
import ReportDialog from "./report-dialog";
import UsageFeedback from "./usage-feedback";
export default function InviteBoard() {
  const [invites, setInvites] = useState<InviteView[]>([]),
    [tokens, setTokens] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState("available"),
    [sort, setSort] = useState("latest"),
    [loading, setLoading] = useState(true),
    [checkedAt, setCheckedAt] = useState(0),
    [error, setError] = useState(""),
    [report, setReport] = useState<{
      invite: InviteView;
      operation?: ConfirmedOperation;
    } | null>(null),
    [operations, setOperations] = useState<Record<string, ConfirmedOperation>>({}),
    [busy, setBusy] = useState<Record<string, boolean>>({}),
    [messages, setMessages] = useState<Record<string, string>>({}),
    [reservations, setReservations] = useState<Record<string, Reservation>>({}),
    [pending, setPending] = useState<Record<string, Pending>>({}),
    [availableTotal, setAvailableTotal] = useState(0),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [announcement, setAnnouncement] = useState("");
  const fetchId = useRef(0),
    pageCount = useRef(1),
    syncing = useRef(false);
  const update = useCallback(
    (v: InviteView) =>
      setInvites((prev) =>
        prev.some((i) => i.id === v.id)
          ? prev.map((i) => (i.id === v.id ? v : i))
          : [v, ...prev],
      ),
    [],
  );
  const load = useCallback(async () => {
    const id = ++fetchId.current;
    try {
      await ensureSession();
      let all: InviteView[] = [];
      let next: number | null = 0;
      let total = 0;
      for (let page = 0; page < pageCount.current && next !== null; page++) {
        const v: {
          invites: InviteView[];
          availableTotal: number;
          nextOffset: number | null;
        } = await request(
          `/api/invites?filter=${filter}&sort=${sort}&limit=50&offset=${next}`,
        );
        all = [...all, ...v.invites];
        next = v.nextOffset;
        total = v.availableTotal;
      }
      if (id === fetchId.current) {
        setInvites([...new Map(all.map((v) => [v.id, v])).values()]);
        setAvailableTotal(total);
        setNextOffset(next);
        setError("");
        setLoading(false);
        setCheckedAt(Date.now());
      }
      const recent = confirmedOperations();
      if (id === fetchId.current) setOperations(recent);
      const missing = Object.values(recent)
        .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
        .slice(0, 20)
        .filter((record) => !all.some((v) => v.id === record.inviteId));
      if (missing.length) {
        const results = await Promise.allSettled(
          missing.map((record) =>
            request<{ invite: InviteView }>("/api/invites/" + record.inviteId),
          ),
        );
        if (id === fetchId.current) {
          const recentInvites = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.invite] : [],
          );
          setInvites((current) => [
            ...new Map(
              [...recentInvites, ...current].map((v) => [v.id, v]),
            ).values(),
          ]);
        }
      }
    } catch (e) {
      if (id === fetchId.current) setError((e as Error).message);
    } finally {
      if (id === fetchId.current) setLoading(false);
    }
  }, [filter, sort]);
  function resultMessage(result: CopyResult, id: string) {
    if (result.invite) update(result.invite);
    if (result.status === "confirmed" && result.operationId) {
      const operation = rememberConfirmedOperation(id, result.operationId);
      setOperations((v) => ({ ...v, [id]: operation }));
    }
    const message =
      result.status === "confirmed"
        ? result.counted
          ? "已复制！预计剩余 " + result.invite?.remaining + " 次"
          : "已复制。10 分钟内重复领取不再扣次数"
        : (result.message ?? "复制未完成");
    setAnnouncement(message);
    if (
      result.status === "confirmed" &&
      result.counted &&
      result.invite?.remaining === 0
    )
      setAvailableTotal((v) => Math.max(0, v - 1));
    setMessages((v) => ({
      ...v,
      [id]: message,
    }));
    if (result.status === "pending" && result.pending)
      setPending((v) => ({ ...v, [id]: result.pending! }));
    else
      setPending((v) => {
        const n = { ...v };
        delete n[id];
        return n;
      });
  }
  async function syncPending() {
    if (syncing.current) return;
    syncing.current = true;
    try {
      for (const p of pendingOperations()) {
        const r = await retryPending({ pending: p, api: claimApi, storage });
        resultMessage(r, p.inviteId);
      }
    } finally {
      syncing.current = false;
    }
  }
  useEffect(() => {
    pageCount.current = 1;
    setInvites([]);
    setNextOffset(null);
    setLoading(true);
    setTokens(ownerTokens());
    setOperations(confirmedOperations());
    load().then(syncPending);
    const online = () => {
      syncPending().then(load);
    };
    const interval = setInterval(() => {
      if (!document.hidden) {
        syncPending().then(load);
      }
    }, 15000);
    window.addEventListener("online", online);
    const changed = (event: StorageEvent) => {
      if (event.key?.startsWith("muse:confirmed:")) {
        storage.sync(event.key, event.newValue);
        setOperations(confirmedOperations());
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("storage", changed);
    };
  }, [load]);
  async function submitOutcome(
    operation: ConfirmedOperation,
    input: UsageFeedbackInput,
  ) {
    try {
      const queued = queueUsageFeedback(operation, input);
      setOperations((v) => ({ ...v, [operation.inviteId]: queued }));
      setReport((current) =>
        current?.operation?.operationId === operation.operationId
          ? { ...current, operation: queued }
          : current,
      );
      if (queued.feedback) return;
      const result = await submitUsageOutcome(
        queued.operationId,
        queued.pendingFeedback!,
      );
      update(result.invite);
      recordUsageFeedback(operation.inviteId, operation.operationId, result.feedback);
      setOperations(confirmedOperations());
      const message =
        result.feedback.outcome === "success"
          ? "使用成功反馈已记录，谢谢你帮助大家验证！"
          : "未能使用的反馈已记录，将由维护者核实。谢谢你的提醒！";
      setMessages((v) => ({ ...v, [operation.inviteId]: message }));
      setAnnouncement(message);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429
      ) {
        expireConfirmedOperation(operation.inviteId, operation.operationId);
        setReport((current) =>
          current?.operation?.operationId === operation.operationId
            ? null
            : current,
        );
        const message = (e as Error).message;
        setMessages((v) => ({ ...v, [operation.inviteId]: message }));
        setAnnouncement(message);
      }
      setOperations(confirmedOperations());
      throw e;
    }
  }
  async function copy(invite: InviteView) {
    if (busy[invite.id]) return;
    setBusy((v) => ({ ...v, [invite.id]: true }));
    setMessages((v) => ({ ...v, [invite.id]: "" }));
    try {
      let result: CopyResult;
      if (pending[invite.id])
        result = await retryPending({
          pending: pending[invite.id],
          api: claimApi,
          storage,
        });
      else {
        const clipboard =
          typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
            ? {
                writeDeferred: (code: Promise<string>) =>
                  navigator.clipboard.write([
                    new ClipboardItem({
                      "text/plain": code.then(
                        (c) => new Blob([c], { type: "text/plain" }),
                      ),
                    }),
                  ]),
              }
            : {
                writeText: (code: string) => {
                  if (!navigator.clipboard?.writeText)
                    throw new Error(
                      "当前浏览器无法复制，请允许剪贴板权限或使用支持的浏览器",
                    );
                  return navigator.clipboard.writeText(code);
                },
              };
        result = await copyInvite({
          inviteId: invite.id,
          api: claimApi,
          clipboard,
          storage,
          reservation: reservations[invite.id],
        });
      }
      if (result.reservation)
        setReservations((v) => ({ ...v, [invite.id]: result.reservation! }));
      else
        setReservations((v) => {
          const n = { ...v };
          delete n[invite.id];
          return n;
        });
      resultMessage(result, invite.id);
      if (result.status === "cancelled" || result.status === "expired")
        await load();
    } catch (e) {
      setMessages((v) => ({ ...v, [invite.id]: (e as Error).message }));
    } finally {
      setBusy((v) => ({ ...v, [invite.id]: false }));
    }
  }
  const shown = invites
    .filter(
      (i) =>
        filter === "all" ||
        (filter === "available"
          ? i.remaining > 0 && i.reviewStatus !== "invalid"
          : filter === "pending"
            ? i.reviewStatus === "pending"
            : i.remaining === 0),
    )
    .sort(
      (a, b) =>
        (a.reviewStatus === "pending" ? 1 : 0) -
          (b.reviewStatus === "pending" ? 1 : 0) ||
        (sort === "remaining" ? b.remaining - a.remaining : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const recentIds = Object.values(operations)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
    .slice(0, 20)
    .map((v) => v.inviteId);
  const recentShown = recentIds.flatMap((id) => {
    const invite = invites.find((v) => v.id === id);
    return invite && !shown.some((v) => v.id === id) ? [invite] : [];
  });
  function inviteCard(invite: InviteView) {
    const operation = operations[invite.id];
    return (
      <InviteCard
        key={invite.id}
        invite={invite}
        checkedAt={checkedAt}
        ownerToken={tokens[invite.id]}
        onUpdate={update}
        onReport={() => setReport({ invite })}
        onCopy={() => copy(invite)}
        busy={!!busy[invite.id]}
        message={messages[invite.id]}
        copyLabel={
          pending[invite.id]
            ? "重试次数同步"
            : reservations[invite.id]
              ? "名额已预留，点击复制"
              : undefined
        }
        usageFeedback={
          operation && (
            <UsageFeedback
              key={operation.operationId}
              operation={operation}
              onSuccess={() => submitOutcome(operation, { outcome: "success" })}
              onFailure={() => setReport({ invite, operation })}
            />
          )
        }
      />
    );
  }
  return (
    <>
      <ShareForm
        onShare={(invite, token) => {
          update(invite);
          setTokens((v) => ({ ...v, [invite.id]: token }));
          setFilter(invite.remaining === 0 ? "exhausted" : "available");
        }}
      />
      <section
        className="board-section"
        id="invites"
        aria-labelledby="board-title"
      >
        <div className="board-heading">
          <div>
            <span className="eyebrow">THE SHARING BOARD</span>
            <h2 id="board-title">
              邀请码广场
              <span className="count-pill">{availableTotal} 个可领取</span>
            </h2>
            <p>挑选一个邀请码，复制后前往 MUSE 粘贴使用。</p>
          </div>
          <a className="board-share" href="#share">
            我也来分享
            <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="board-toolbar">
          <div className="filter-tabs" role="group" aria-label="筛选邀请码">
            {[
              ["available", "可领取"],
              ["pending", "待核实"],
              ["exhausted", "已用完"],
              ["all", "全部"],
            ].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={filter === v}
                className={filter === v ? "active" : ""}
                onClick={() => setFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sort-control">
            <SlidersHorizontal size={14} />
            <label className="sr-only" htmlFor="sort">
              邀请码排序
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="latest">最新分享</option>
              <option value="remaining">剩余最多</option>
            </select>
            <button
              className="refresh-button"
              aria-label="刷新邀请码"
              onClick={() => {
                setLoading(true);
                load();
              }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <p
          className={announcement ? "board-announcement" : "sr-only"}
          role="status"
          aria-live="polite"
        >
          {announcement}
        </p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={load}>重新加载</button>
          </div>
        )}
        {recentShown.length > 0 && (
          <section className="recent-claims" aria-labelledby="recent-title">
            <h3 id="recent-title">你最近领取的</h3>
            <p>
              领取后 7 天内可反馈实际使用结果。已用完或不在当前分类中的邀请码仍会显示在这里。
            </p>
            <div className="invite-grid">{recentShown.map(inviteCard)}</div>
          </section>
        )}
        {loading && invites.length === 0 ? (
          <div className="empty-state">
            <RefreshCw className="spin" size={24} />
            <h3>正在加载共享邀请码…</h3>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Gift size={30} />
            </div>
            <h3>
              {filter === "all" && invites.length === 0
                ? "还没有邀请码，成为第一位分享者。"
                : "这个分类暂时没有邀请码。"}
            </h3>
            <p>把手中的一次机会，留给正在寻找的人。</p>
            <a href="#share">
              分享我的邀请码
              <ArrowUpRight size={15} />
            </a>
          </div>
        ) : (
          <div className="invite-grid">
            {shown.map(inviteCard)}
          </div>
        )}
        {nextOffset !== null && (
          <button
            className="load-more"
            disabled={loading}
            onClick={() => {
              pageCount.current += 1;
              setLoading(true);
              load();
            }}
          >
            {loading ? "正在加载…" : "加载更多邀请码"}
          </button>
        )}
        <div className="board-footnote">
          <ShieldCheck size={15} />
          <span>
            余量按分享者填写的次数与本站复制记录估算，实际以 MUSE
            为准。请在有问题时反馈，帮助下一位领取者。
          </span>
        </div>
      </section>
      <section className="how-section" id="guide">
        <div className="how-heading">
          <span className="eyebrow">A LITTLE HELP GOES A LONG WAY</span>
          <h2>互助，从一次分享开始。</h2>
          <p>不需要注册，只需要一点分享的心意。</p>
        </div>
        <div className="how-steps">
          {[
            [
              "01",
              "分享你的机会",
              "填写邀请码与目前剩余次数，录入时间自动记录。",
            ],
            [
              "02",
              "复制并前往使用",
              "点击复制领取，到 MUSE 粘贴。复制成功后本站余量减一。",
            ],
            [
              "03",
              "让信息保持可靠",
              "实际使用后反馈成功或失败，让后来的朋友少走弯路。",
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <div className="community-line">
          <HeartHandshake size={18} />
          <span>机会因为分享而流动，社区因为互助而生长。</span>
        </div>
      </section>
      {report && (
        <ReportDialog
          key={report.operation?.operationId ?? report.invite.id}
          invite={report.invite}
          usageOperation={report.operation}
          onUsageFeedback={
            report.operation
              ? (input) => submitOutcome(report.operation!, input)
              : undefined
          }
          onClose={() => setReport(null)}
          onUpdate={(v) => {
            update(v);
            setMessages((m) => ({
              ...m,
              [v.id]: "反馈已记录，将由维护者核实。谢谢你的提醒！",
            }));
          }}
        />
      )}
    </>
  );
}
