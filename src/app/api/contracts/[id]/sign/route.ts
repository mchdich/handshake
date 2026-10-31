import { NextResponse } from "next/server";
import { sign } from "@/lib/escrow";
import { fail, ownContract, party } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ownContract((await params).id);
    const body = await req.json();
    return NextResponse.json(sign(c.id, party(body.party)));
  } catch (e) {
    return fail(e);
  }
}
