import { NextResponse } from "next/server";
import { contracts, events, milestones } from "@/lib/db";
import { fail, workspace } from "@/lib/http";

export async function GET() {
  try {
    const ws = await workspace();
    const cs = contracts.list(ws);
    const titles = Object.fromEntries(cs.map((c) => [c.id, c.title]));
    const ms = cs.flatMap((c) => milestones.forContract(c.id));
    const sum = (f: (m: (typeof ms)[number]) => number) => Math.round(ms.reduce((a, m) => a + f(m), 0) * 100) / 100;
    return NextResponse.json({
      totals: {
        held: sum((m) => (["funded", "in_review", "changes_requested", "disputed"].includes(m.status) ? m.amountUsd : 0)),
        captured: sum((m) => m.paypal.capturedUsd ?? 0),
        fees: sum((m) => m.paypal.feeUsd ?? 0),
        paidOut: sum((m) => m.paypal.payoutUsd ?? 0),
        returned: sum((m) =>
          m.status === "refunded" ? m.amountUsd : m.status === "settled" ? m.amountUsd - (m.paypal.capturedUsd ?? 0) : 0,
        ),
      },
      events: events.list(ws).map((e) => ({ ...e, contract: e.contractId ? titles[e.contractId] : undefined })),
      milestones: ms.map((m) => ({ ...m, contract: titles[m.contractId] })),
    });
  } catch (e) {
    return fail(e);
  }
}
