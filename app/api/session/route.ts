import { handle } from "@/lib/server/route";
import { json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(request, async () => json({ ready: true }));
}
