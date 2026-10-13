import { handle } from "@/lib/server/route";
import { json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { reserveClaim } from "@/lib/server/claim-repository";
import { AppError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handle(request, async ({ db, visitorHash }) => {
    const v = await readJson(request);
    if (typeof v.inviteId !== "string" || typeof v.operationId !== "string")
      throw new AppError(400, "invalid_operation", "领取参数不正确");
    await rateLimit(db, "claim:" + visitorHash, 30, 60);
    return json(
      await reserveClaim(db, {
        inviteId: v.inviteId,
        operationId: v.operationId,
        visitorHash,
      }),
    );
  });
}
