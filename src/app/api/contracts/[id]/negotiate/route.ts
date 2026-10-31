import { negotiate } from "@/lib/escrow";
import { fail, ndjson, ownContract } from "@/lib/http";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ownContract((await params).id);
    return ndjson((send) => negotiate(c.id, send));
  } catch (e) {
    return fail(e);
  }
}
