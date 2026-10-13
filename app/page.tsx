import { ArrowUpRight, Heart, MoveUpRight, Sparkles } from "lucide-react";
import InviteBoard from "@/components/invite-board";
const support = "https://support.coinexo.top/";
export default function Home() {
  return (
    <>
      <a className="skip-link" href="#share">
        跳到分享表单
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="MUSE 互助会首页">
            <span className="brand-symbol">
              m<span>✳</span>
            </span>
            <span className="brand-text">
              MUSE<small>互助会</small>
            </span>
          </a>
          <nav aria-label="主导航">
            <a href="#invites">邀请码广场</a>
            <a href="#guide">使用说明</a>
          </nav>
          <a
            className="support-link"
            href={support}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Heart size={14} />
            支持项目
            <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main className="site-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-badge">
              <span className="live-dot" />
              OPEN TO EVERYONE<span>公开分享 · 免费领取</span>
            </div>
            <h1>
              分享一次机会，
              <br />
              让更多人遇见 <em>MUSE</em>。
            </h1>
            <p>
              一个简单、开放的邀请码互助空间。
              <br />
              分享你手中的邀请，开启他人的下一段探索。
            </p>
            <a className="hero-action" href="#invites">
              寻找一个邀请码
              <MoveUpRight size={16} />
            </a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="art-star star-one">✳</div>
            <div className="art-star star-two">✦</div>
            <div className="art-ticket ticket-back">
              <span>ONE INVITE</span>
              <span>NEW POSSIBILITIES</span>
            </div>
            <div className="art-ticket ticket-front">
              <div className="ticket-top">
                A LITTLE INVITATION
                <Sparkles size={18} />
              </div>
              <strong>MUSE</strong>
              <div className="ticket-rule" />
              <div className="ticket-bottom">
                <span>SHARE. CONNECT. EXPLORE.</span>
                <span>↗</span>
              </div>
            </div>
            <div className="art-tag">
              <Heart size={13} />
              让机会流动起来
            </div>
          </div>
        </section>
        <InviteBoard />
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <a className="footer-brand" href="/">
              MUSE <span>互助会</span>
            </a>
            <p>由社区分享，为下一次相遇。</p>
            <small>社区互助网站 · 非 MUSE 官方平台</small>
          </div>
          <div className="footer-links">
            <a
              href="https://github.com/henryli777/muse-mutual"
              target="_blank"
              rel="noopener noreferrer"
            >
              项目源码
              <ArrowUpRight size={13} />
            </a>
            <a href={support} target="_blank" rel="noopener noreferrer">
              <Heart size={13} />
              支持项目
              <ArrowUpRight size={13} />
            </a>
            <a href="/admin">维护入口</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>分享有余，互助无界。</span>
          <span>MADE FOR THE COMMUNITY</span>
        </div>
      </footer>
    </>
  );
}
