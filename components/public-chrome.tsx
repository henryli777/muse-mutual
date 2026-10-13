import { ArrowUpRight, Heart } from "lucide-react";
const support = "https://support.coinexo.top/";
export function PublicHeader() {
  return (
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
          <a href="/#invites">邀请码广场</a>
          <a href="/#guide">使用说明</a>
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
  );
}
export function PublicFooter() {
  return (
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
  );
}
