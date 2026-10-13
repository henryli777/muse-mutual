"use client";
import { usePathname } from "next/navigation";
import { PublicHeader, PublicFooter } from "./public-chrome";
export default function PageFallback({
  missing = false,
  reset,
}: {
  missing?: boolean;
  reset?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const publicPage = !/^\/(admin|api)(\/|$)/.test(pathname);
  return (
    <>
      {publicPage && <PublicHeader />}
      <main className="fallback-page">
        <span className="eyebrow">
          {missing ? "404 · PAGE NOT FOUND" : "PLEASE TRY AGAIN"}
        </span>
        <h1>{missing ? "这个页面暂时没有找到。" : "页面暂时无法加载。"}</h1>
        <p>
          {missing
            ? "回到邀请码广场，继续分享与寻找机会。"
            : "请稍后重试，已经分享的邀请码会保留。"}
        </p>
        <div className="fallback-actions">
          {reset && (
            <button className="primary" onClick={reset}>
              重新加载
            </button>
          )}
          <a className="primary" href={publicPage ? "/" : "/admin"}>
            {publicPage ? "返回邀请码广场" : "返回维护入口"}
          </a>
        </div>
      </main>
      {publicPage && <PublicFooter />}
    </>
  );
}
