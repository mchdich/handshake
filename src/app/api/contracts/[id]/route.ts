import { NextResponse } from "next/server";
import { events, milestones, submissions, turns } from "@/lib/db";
import { fail, ownContract } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ownContract((await params).id);
    const ms = milestones.forContract(c.id);
    return NextResponse.json({
      contract: c,
      milestones: ms.map((m) => ({
        ...m,
        submissions: submissions.forMilestone(m.id).map((s) => ({
          ...s,
          image: s.image && { ...s.image, data: undefined },
          shots: s.shots?.map((x) => ({ label: x.label })),
        })),
      })),
      turns: turns.forContract(c.id),
      events: events.forContract(c.id),
    });
  } catch (e) {
    return fail(e);
  }
}
