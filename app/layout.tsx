import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MUSE 互助会 · 分享一次机会",
  description:
    "公开分享 MUSE 邀请码，复制领取、查看预计剩余次数，反馈错误和失效。一个简单、开放的社区互助空间。",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "MUSE 互助会",
    description: "分享一次机会，让更多人遇见 MUSE。",
    locale: "zh_CN",
    type: "website",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
