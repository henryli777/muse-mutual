"use client";
import { useState } from "react";
import { Plus, ArrowUpRight, Sparkles } from "lucide-react";
import { ensureSession, request } from "@/lib/client/api";
import { storage, ownerTokens } from "@/lib/client/storage";
import type { InviteView } from "@/lib/domain";
export default function ShareForm({
  onShare,
}: {
  onShare: (invite: InviteView, token: string) => void;
}) {
  const [code, setCode] = useState(""),
    [remaining, setRemaining] = useState("30"),
    [nickname, setNickname] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await ensureSession();
      const out = await request<{ invite: InviteView; ownerToken: string }>(
        "/api/invites",
        "POST",
        { code, remaining: Number(remaining), nickname },
      );
      const tokens = { ...ownerTokens(), [out.invite.id]: out.ownerToken };
      storage.setItem("muse:owners", JSON.stringify(tokens));
      onShare(out.invite, out.ownerToken);
      setCode("");
      setRemaining("30");
      setNickname("");
      setMessage("分享成功，管理凭据已保留在本设备。谢谢你分享一次机会！");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="share-panel" id="share" aria-labelledby="share-title">
      <div className="share-heading">
        <div className="section-icon">
          <Plus size={22} />
        </div>
        <div>
          <h2 id="share-title">把你的邀请码分享出来</h2>
          <p>一次小小的分享，可能是另一个人的开始。</p>
        </div>
        <span className="soft-pill">
          <Sparkles size={13} />
          无需注册
        </span>
      </div>
      <form onSubmit={submit} className="share-form">
        <div className="field code-field">
          <label htmlFor="invite-code">
            MUSE 邀请码 <span>*</span>
          </label>
          <input
            id="invite-code"
            maxLength={200}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="粘贴你的邀请码"
            required
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="field remaining-field">
          <label htmlFor="remaining">
            预计剩余次数 <span>*</span>
          </label>
          <div className="input-suffix">
            <input
              id="remaining"
              type="number"
              min="0"
              max="30"
              step="1"
              value={remaining}
              onChange={(e) => setRemaining(e.target.value)}
              required
            />
            <span>次</span>
          </div>
        </div>
        <div className="field nickname-field">
          <label htmlFor="nickname">
            分享者昵称 <small>选填</small>
          </label>
          <input
            id="nickname"
            maxLength={40}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="匿名也可以"
            autoComplete="nickname"
          />
        </div>
        <button className="primary share-submit" disabled={busy}>
          {busy ? "正在分享…" : "分享邀请码"}
          <ArrowUpRight size={18} />
        </button>
      </form>
      <div className="share-note">
        <span>提交时间自动记录 · 复制领取后余量减一</span>
        <span>实际可用次数以 MUSE 为准</span>
      </div>
      <p className="form-message" role="status">
        {message}
      </p>
    </section>
  );
}
