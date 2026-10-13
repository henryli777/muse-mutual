"use client";
import { useEffect, useRef, useState } from "react";
import { X, Flag, Heart, ArrowUpRight } from "lucide-react";
import { request } from "@/lib/client/api";
import type { InviteView, ReportReason } from "@/lib/domain";
import type { ConfirmedOperation, UsageFeedbackInput } from "@/lib/client/storage";
import { support } from "./public-chrome";
export default function ReportDialog({
  invite,
  onClose,
  onUpdate,
  usageOperation,
  onUsageFeedback,
}: {
  invite: InviteView;
  onClose: () => void;
  onUpdate: (v: InviteView) => void;
  usageOperation?: ConfirmedOperation;
  onUsageFeedback?: (input: UsageFeedbackInput) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason>(
      usageOperation?.pendingFeedback?.reason ?? "expired",
    ),
    [note, setNote] = useState(usageOperation?.pendingFeedback?.note ?? ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const immutable = !!usageOperation?.pendingFeedback;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (usageOperation && onUsageFeedback) {
        await onUsageFeedback({ outcome: "failure", reason, note });
        onClose();
        return;
      }
      const { invite: v } = await request<{ invite: InviteView }>(
        "/api/reports",
        "POST",
        { inviteId: invite.id, reason, note },
      );
      onUpdate(v);
      onClose();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-labelledby="report-title"
    >
      <nav className="modal-public-nav" aria-label="反馈页面导航">
        <a className="support-link" href={support} target="_blank" rel="noopener noreferrer">
          <Heart size={14} />
          支持项目
          <ArrowUpRight size={14} />
        </a>
        <button className="close-button" onClick={onClose} aria-label="关闭反馈">
          <X size={20} />
        </button>
      </nav>
      <div className="modal-icon">
        <Flag size={22} />
      </div>
      <h2 id="report-title">
        {usageOperation
          ? "在 MUSE 未能使用这个邀请码？"
          : "这个邀请码遇到问题了吗？"}
      </h2>
      <p>
        {usageOperation
          ? "记录实际使用结果，帮助下一位使用者。问题会交由维护者核实，反馈不会再次扣减次数。"
          : "你的反馈会帮助下一位使用者。反馈会先标记为待核实。"}
      </p>
      {immutable && (
        <p>上次提交尚未确认，请重试相同的问题类型与说明。</p>
      )}
      <div className="modal-code">{invite.code}</div>
      <form onSubmit={submit}>
        <fieldset disabled={busy || immutable}>
          <legend>问题类型</legend>
          {(
            [
              ["expired", "已失效"],
              ["incorrect", "邀请码错误"],
              ["other", "其他问题"],
            ] as const
          ).map(([value, label]) => (
            <label className="radio-option" key={value}>
              <input
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label htmlFor="report-note">
          补充说明 <small>选填，仅维护者可见</small>
        </label>
        <textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          disabled={busy || immutable}
          placeholder="例如：MUSE 提示邀请码不存在。请勿填写个人敏感信息。"
          rows={3}
        />
        <p role="status" className="form-message">
          {message}
        </p>
        <button className="primary" disabled={busy}>
          {busy ? "提交中…" : immutable ? "重试这次反馈" : "提交反馈"}
        </button>
      </form>
    </dialog>
  );
}
