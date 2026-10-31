import { NextResponse } from "next/server";
import { events, milestoneByPayPalRef, milestones, contracts, webhookLog } from "@/lib/db";
import { verifyWebhook } from "@/lib/paypal";

// PayPal tells us when a payout lands or a payment changes outside our own calls.
export async function POST(req: Request) {
  const raw = await req.text();
  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, raw);
  } catch (e) {
    console.error("webhook verify failed", e);
  }
  const body = JSON.parse(raw) as {
    id: string;
    event_type: string;
    summary?: string;
    resource?: { id?: string; payout_batch_id?: string; batch_header?: { payout_batch_id?: string; batch_status?: string }; transaction_status?: string };
  };
  webhookLog.add(body.id, verified, body);
  if (!verified) return NextResponse.json({ ok: false }, { status: 400 });

  const r = body.resource ?? {};
  const ref = r.batch_header?.payout_batch_id ?? r.payout_batch_id ?? r.id;
  const m = ref ? milestoneByPayPalRef(ref) : undefined;
  if (m) {
    const c = contracts.get(m.contractId);
    if (body.event_type.startsWith("PAYMENT.PAYOUTS") || body.event_type.startsWith("PAYMENT.PAYOUTSBATCH")) {
      m.paypal.payoutStatus = r.batch_header?.batch_status ?? r.transaction_status ?? m.paypal.payoutStatus;
      milestones.save(m);
    }
    if (c) {
      events.add({
        ws: c.ws,
        contractId: c.id,
        milestoneId: m.id,
        type: "webhook",
        actor: "paypal",
        ref,
        detail: `${body.event_type}${body.summary ? ` — ${body.summary}` : ""}`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
