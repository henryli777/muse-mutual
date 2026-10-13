import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
// During a hosting move, the old origin can forward visitors to the live site.
export function middleware(request: NextRequest) {
  const canonical = (env as unknown as { MUSE_CANONICAL_ORIGIN?: string })
    .MUSE_CANONICAL_ORIGIN;
  if (!canonical) return NextResponse.next();
  const destination = new URL(canonical);
  const source = new URL(request.url);
  if (destination.protocol !== "https:" || destination.origin === source.origin)
    return NextResponse.next();
  destination.pathname = source.pathname;
  destination.search = source.search;
  return NextResponse.redirect(destination, 307);
}
