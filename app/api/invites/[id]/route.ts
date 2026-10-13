import { handle } from "@/lib/server/route";
import { json, readJson } from "@/lib/server/http";
import { hash } from "@/lib/server/identity";
import { updateRemaining } from "@/lib/server/invite-repository";
import { validateRemaining, AppError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(request, async ({ db }) => {
    const token = request.headers.get("X-Owner-Token");
    if (!token || token.length > 200)
      throw new AppError(403, "wrong_owner", "缺少管理凭据");
    const { id } = await params;
    const body = await readJson(request);
    return json({
      invite: await updateRemaining(
        db,
        id,
        await hash(token),
        validateRemaining(body.remaining),
        Math.floor(Date.now() / 1000),
      ),
    });
  });
}
