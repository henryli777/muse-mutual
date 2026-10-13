import { handle } from "@/lib/server/route";
import { json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { submitUsageFeedback } from "@/lib/server/usage-repository";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  return handle(request, async ({ db, visitorHash }) => {
    const { operationId } = await params;
    const value = await readJson(request);
    await rateLimit(db, "usage:" + visitorHash, 20, 3600);
    return json(await submitUsageFeedback(db, operationId, visitorHash, value));
  });
}
