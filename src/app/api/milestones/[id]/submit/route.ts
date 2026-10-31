import { z } from "zod/v4";
import { NextResponse } from "next/server";
import { submitWork } from "@/lib/escrow";
import { fail, ndjson, ownMilestone } from "@/lib/http";

export const maxDuration = 300;

const Body = z.object({
  note: z.string().max(2000).default(""),
  url: z.url().max(500).optional(),
  text: z.string().max(20000).optional(),
  image: z
    .object({
      name: z.string().max(200),
      mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      data: z.string().max(7_000_000),
    })
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { m } = await ownMilestone((await params).id);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    return ndjson(async (send) => {
      const out = await submitWork(m.id, parsed.data, (stage) => send({ type: "stage", stage }));
      send({ type: "done", milestone: out.milestone, review: out.submission.review });
    });
  } catch (e) {
    return fail(e);
  }
}
