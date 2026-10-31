import { NextResponse } from "next/server";
import { openDispute } from "@/lib/escrow";
import { fail, ownMilestone, party } from "@/lib/http";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { m } = await ownMilestone((await params).id);
    const body = await req.json();
    return NextResponse.json(await openDispute(m.id, party(body.party), String(body.reason ?? "").slice(0, 2000)));
  } catch (e) {
    return fail(e);
  }
}
