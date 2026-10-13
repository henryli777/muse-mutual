"use client";
import "./globals.css";
import PageFallback from "@/components/page-fallback";
export default function GlobalError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <PageFallback reset={reset} />
      </body>
    </html>
  );
}
