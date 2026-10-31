import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FlowError } from "./escrow";
import { PayPalError } from "./paypal";
import { contracts, milestones, type Contract, type Milestone } from "./db";
import { ensureSeed } from "./seed";

export async function workspace(): Promise<string> {
  const ws = (await cookies()).get("hs_ws")?.value;
  if (!ws) throw new FlowError("Reload the page to start a workspace.", 401);
  ensureSeed(ws);
  return ws;
}

export async function ownContract(id: string): Promise<Contract> {
  const ws = await workspace();
  const c = contracts.get(id);
  if (!c || c.ws !== ws) throw new FlowError("Contract not found", 404);
  return c;
}

export async function ownMilestone(id: string): Promise<{ m: Milestone; c: Contract }> {
  const m = milestones.get(id);
  if (!m) throw new FlowError("Milestone not found", 404);
  return { m, c: await ownContract(m.contractId) };
}

export function fail(e: unknown) {
  if (e instanceof FlowError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof PayPalError) {
    console.error(e.message);
    const d = e.details[0];
    return NextResponse.json(
      { error: `PayPal said no: ${d?.description ?? d?.issue ?? e.op + " failed"}` },
      { status: 502 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status: 500 });
}

export const party = (v: unknown) => {
  if (v !== "client" && v !== "freelancer") throw new FlowError("party must be client or freelancer");
  return v;
};

/** Newline-delimited JSON stream: lets the UI show agents working in real time. */
export function ndjson(run: (send: (obj: unknown) => void) => Promise<void>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (obj: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        await run(send);
      } catch (e) {
        const msg =
          e instanceof PayPalError
            ? `PayPal said no: ${e.details[0]?.description ?? e.op + " failed"}`
            : e instanceof Error
              ? e.message
              : String(e);
        send({ type: "error", message: msg });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
