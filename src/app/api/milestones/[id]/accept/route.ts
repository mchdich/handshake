import { NextResponse } from "next/server";
import { acceptRuling } from "@/lib/escrow";
import { fail, ownMilestone, party } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { m } = await ownMilestone((await params).id);
    const body = await req.json();
    return NextResponse.json(await acceptRuling(m.id, party(body.party)));
  } catch (e) {
    return fail(e);
  }
}
