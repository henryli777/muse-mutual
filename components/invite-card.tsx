"use client";
import { useState } from "react";
import {
  Copy,
  Check,
  Clock3,
  Flag,
  AlertCircle,
  UserRound,
  MinusCircle,
  Pencil,
  LoaderCircle,
} from "lucide-react";
import { inviteStatus } from "@/lib/domain";
import type { InviteView } from "@/lib/domain";
import { request } from "@/lib/client/api";
const statuses = {
  available: { label: "可领取", Icon: Check },
  low: { label: "即将用完", Icon: AlertCircle },
  pending: { label: "待核实", Icon: Flag },
  exhausted: { label: "已用完", Icon: MinusCircle },
  invalid: { label: "已失效", Icon: MinusCircle },
};
export default function InviteCard({
  invite,
  ownerToken,
  onUpdate,
  onReport,
  onCopy,
  busy,
  message,
  copyLabel,
}: {
  invite: InviteView;
  ownerToken?: string;
  onUpdate: (v: InviteView) => void;
  onReport: () => void;
  onCopy: () => void;
  busy: boolean;
  message?: string;
  copyLabel?: string;
}) {
  const state = inviteStatus(invite),
    { Icon, label } = statuses[state];
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(String(invite.remaining)),
    [editBusy, setEditBusy] = useState(false),
    [editError, setEditError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setEditBusy(true);
    try {
      const { invite: v } = await request<{ invite: InviteView }>(
        "/api/invites/" + invite.id,
        "PATCH",
        { remaining: Number(value) },
        { "X-Owner-Token": ownerToken ?? "" },
      );
      onUpdate(v);
      setEditing(false);
      setEditError("");
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }
  return (
    <article className={"invite-card state-" + state}>
      <div className="card-top">
        <span className="sharer">
          <span className="avatar">
            <UserRound size={15} />
          </span>
          {invite.nickname || "匿名分享者"}
        </span>
        <span className={"status-badge " + state}>
          <Icon size={12} />
          {label}
        </span>
      </div>
      <div className="code-box">
        <span className="code-label">MUSE INVITE CODE</span>
        <p className="invite-code">{invite.code}</p>
      </div>
      <div className="quota-row">
        <div>
          <span className="quota-label">预计剩余</span>
          <strong>
            {invite.remaining}
            <small> 次</small>
          </strong>
        </div>
        <span className="copy-count">本站已领取 {invite.copiedCount} 次</span>
      </div>
      <div className="quota-track" aria-hidden="true">
        <i
          style={{ width: Math.min(100, (invite.remaining / 30) * 100) + "%" }}
        />
      </div>
      <div className="card-time">
        <Clock3 size={12} />
        <time dateTime={invite.createdAt}>
          {new Date(invite.createdAt).toLocaleString("zh-CN", {
            hour12: false,
          })}
        </time>
      </div>
      {invite.updatedAt !== invite.createdAt && (
        <p className="update-time">
          余量/审核更新：
          {new Date(invite.updatedAt).toLocaleString("zh-CN", {
            hour12: false,
          })}
        </p>
      )}
      {invite.reportCount > 0 && (
        <p className="feedback-note">
          <Flag size={12} />
          {invite.reportCount} 条问题反馈 · 待维护者核实
        </p>
      )}
      <button
        className="copy-button"
        onClick={onCopy}
        disabled={
          busy ||
          invite.reviewStatus === "invalid" ||
          invite.remaining === 0 ||
          (!copyLabel && invite.available === 0)
        }
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Copy size={16} />
        )}
        <span>
          {busy
            ? "处理中…"
            : (copyLabel ??
              (invite.available === 0 && invite.remaining > 0
                ? "名额暂被预留"
                : "复制领取"))}
        </span>
      </button>
      <div className="card-bottom">
        <button className="text-button" onClick={onReport}>
          <Flag size={12} />
          反馈问题
        </button>
        {ownerToken && (
          <button
            className="text-button"
            onClick={() => {
              setValue(String(invite.remaining));
              setEditing(!editing);
            }}
          >
            <Pencil size={12} />
            修改余量
          </button>
        )}
      </div>
      {editing && (
        <form className="inline-edit" onSubmit={save}>
          <label>
            剩余
            <input
              type="number"
              min={0}
              max={30}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button disabled={editBusy}>保存</button>
          <button type="button" onClick={() => setEditing(false)}>
            取消
          </button>
          <p role="status">{editError}</p>
        </form>
      )}
      {message && (
        <p role="status" className="card-message">
          {message}
        </p>
      )}
    </article>
  );
}
