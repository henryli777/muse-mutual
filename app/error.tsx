"use client";
import PageFallback from "@/components/page-fallback";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return <PageFallback reset={reset} />;
}
