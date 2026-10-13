"use client";
import { useState } from "react";
import { Check, Flag, LoaderCircle } from "lucide-react";
import type { ConfirmedOperation } from "@/lib/client/storage";

export default function UsageFeedback({
  operation,
  onSuccess,
  onFailure,
}: {
  operation: ConfirmedOperation;
  onSuccess: () => Promise<void>;
  onFailure: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = operation.pendingFeedback?.outcome;
  async function success() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (operation.feedback) {
    return (
      <div className="usage-feedback recorded" role="status">
        <Check size={14} />
        <span>
          你已反馈：
          {operation.feedback.outcome === "success" ? "使用成功" : "未能使用"}
          。谢谢你的帮助！
        </span>
      </div>
    );
  }
  return (
    <div className="usage-feedback">
      <p>在 MUSE 使用后，告诉大家结果</p>
      <div className="usage-feedback-actions">
        <button onClick={success} disabled={busy || pending === "failure"}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          {busy
            ? "提交中…"
            : pending === "success"
              ? "重试成功反馈"
              : "使用成功"}
        </button>
        <button onClick={onFailure} disabled={busy || pending === "success"}>
          <Flag size={13} />
          {pending === "failure" ? "重试失败反馈" : "未能使用"}
        </button>
      </div>
      {pending && (
        <small>
          上次提交尚未确认，请重试同一结果。反馈不会再次扣减次数。
        </small>
      )}
      {error && (
        <p role="alert" className="usage-feedback-error">
          {error}
        </p>
      )}
    </div>
  );
}
