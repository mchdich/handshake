import { submissions } from "@/lib/db";
import { FlowError } from "@/lib/escrow";
import { fail, ownMilestone } from "@/lib/http";

/** A screenshot the review agent took of a submitted link. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  try {
    const { id, n } = await params;
    const s = submissions.get(id);
    if (!s) throw new FlowError("Submission not found", 404);
    await ownMilestone(s.milestoneId);
    const shot = s.shots?.[Number(n)];
    if (!shot) throw new FlowError("Screenshot not found", 404);
    return new Response(Buffer.from(shot.data, "base64"), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" },
    });
  } catch (e) {
    return fail(e);
  }
}
