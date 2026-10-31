import { NextResponse } from "next/server";
import { confirmFunding } from "@/lib/escrow";
import { fail, ownMilestone } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { m } = await ownMilestone((await params).id);
    const { orderId } = await req.json();
    return NextResponse.json(await confirmFunding(m.id, String(orderId)));
  } catch (e) {
    return fail(e);
  }
}
