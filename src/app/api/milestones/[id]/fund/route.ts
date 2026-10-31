import { NextResponse } from "next/server";
import { createFundingOrder } from "@/lib/escrow";
import { fail, ownMilestone } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { m } = await ownMilestone((await params).id);
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await createFundingOrder(m.id, { testCard: Boolean(body.testCard) }));
  } catch (e) {
    return fail(e);
  }
}
