import { Heart, MoveUpRight, Sparkles } from "lucide-react";
import InviteBoard from "@/components/invite-board";
import { PublicHeader, PublicFooter } from "@/components/public-chrome";
export default function Home() {
  return (
    <>
      <a className="skip-link" href="#share">
        跳到分享表单
      </a>
      <PublicHeader />
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
      <PublicFooter />
    </>
  );
}
