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
import { ensureSession, request, claimApi } from "@/lib/client/api";
import type { Reservation } from "@/lib/client/api";
import { copyInvite, retryPending } from "@/lib/client/copy-invite";
import type { CopyResult, Pending } from "@/lib/client/copy-invite";
import { storage, ownerTokens, pendingOperations } from "@/lib/client/storage";
import ShareForm from "./share-form";
import InviteCard from "./invite-card";
import ReportDialog from "./report-dialog";
export default function InviteBoard() {
  const [invites, setInvites] = useState<InviteView[]>([]),
    [tokens, setTokens] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState("available"),
    [sort, setSort] = useState("latest"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [report, setReport] = useState<InviteView | null>(null),
    [busy, setBusy] = useState<Record<string, boolean>>({}),
    [messages, setMessages] = useState<Record<string, string>>({}),
    [reservations, setReservations] = useState<Record<string, Reservation>>({}),
    [pending, setPending] = useState<Record<string, Pending>>({});
  const fetchId = useRef(0),
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
      const v = await request<{ invites: InviteView[] }>(
        "/api/invites?filter=all",
      );
      if (id === fetchId.current) {
        setInvites(v.invites);
        setError("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  function resultMessage(result: CopyResult, id: string) {
    if (result.invite) update(result.invite);
    setMessages((v) => ({
      ...v,
      [id]:
        result.status === "confirmed"
          ? result.counted
            ? "已复制！预计剩余 " + result.invite?.remaining + " 次"
            : "已复制。10 分钟内重复领取不再扣次数"
          : (result.message ?? "复制未完成"),
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
    setTokens(ownerTokens());
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
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", online);
    };
  }, [load]);
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
              <span className="count-pill">
                {
                  invites.filter(
                    (i) => i.remaining > 0 && i.reviewStatus !== "invalid",
                  ).length
                }{" "}
                个可领取
              </span>
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
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={load}>重新加载</button>
          </div>
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
              {invites.length === 0
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
            {shown.map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                ownerToken={tokens[invite.id]}
                onUpdate={update}
                onReport={() => setReport(invite)}
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
              />
            ))}
          </div>
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
              "遇到错误或失效，留下反馈，让后来的朋友少走弯路。",
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
          key={report.id}
          invite={report}
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
