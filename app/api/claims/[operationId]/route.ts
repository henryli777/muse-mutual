import { handle } from "@/lib/server/route";
import { json, readJson } from "@/lib/server/http";
import { confirmClaim, cancelClaim } from "@/lib/server/claim-repository";
import { AppError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  return handle(request, async ({ db, visitorHash }) => {
    const { operationId } = await params;
    const v = await readJson(request);
    if (v.action === "confirm")
      return json(await confirmClaim(db, operationId, visitorHash));
    if (v.action === "cancel") {
      await cancelClaim(db, operationId, visitorHash);
      return json({ cancelled: true });
    }
    throw new AppError(400, "invalid_action", "请选择确认或取消");
  });
}
