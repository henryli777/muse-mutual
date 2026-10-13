"use client";
import { useEffect, useRef, useState } from "react";
import { X, Flag } from "lucide-react";
import { request } from "@/lib/client/api";
import type { InviteView, ReportReason } from "@/lib/domain";
export default function ReportDialog({
  invite,
  onClose,
  onUpdate,
}: {
  invite: InviteView;
  onClose: () => void;
  onUpdate: (v: InviteView) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason>("expired"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
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
      <button className="close-button" onClick={onClose} aria-label="关闭反馈">
        <X size={20} />
      </button>
      <div className="modal-icon">
        <Flag size={22} />
      </div>
      <h2 id="report-title">这个邀请码遇到问题了吗？</h2>
      <p>你的反馈会帮助下一位使用者。反馈会先标记为待核实。</p>
      <div className="modal-code">{invite.code}</div>
      <form onSubmit={submit}>
        <fieldset>
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
          placeholder="例如：MUSE 提示邀请码不存在。请勿填写个人敏感信息。"
          rows={3}
        />
        <p role="status" className="form-message">
          {message}
        </p>
        <button className="primary" disabled={busy}>
          {busy ? "提交中…" : "提交反馈"}
        </button>
      </form>
    </dialog>
  );
}
