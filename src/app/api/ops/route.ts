import { z } from "zod/v4";
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/llm";
import { opsTools } from "@/lib/paypal-agent";
import { fail, ndjson, workspace } from "@/lib/http";

export const maxDuration = 300;

const Body = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .min(1)
    .max(20),
});

const SYSTEM = `You are Handshake's money assistant for one workspace. You answer questions about contracts, holds, payouts, invoices, disputes and PayPal transactions, and you can take small actions (like sending an invoice reminder) when asked.
Use the [Handshake] tools for this workspace's contracts and ledger; use the [PayPal Agent Toolkit] tools to look things up in PayPal itself. Note: the PayPal account is shared by every demo workspace, so when you use PayPal tools, filter results to the ids that appear in this workspace's contracts or ledger.
Be brief and specific: amounts, dates, statuses, ids. Never invent numbers. Today is ${new Date().toISOString().slice(0, 10)}.`;

export async function POST(req: Request) {
  try {
    const ws = await workspace();
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    return ndjson(async (send) => {
      const out = await runAgent({
        system: SYSTEM,
        history: parsed.data.history,
        tools: opsTools(ws),
        onStep: (s) => send({ type: "step", step: s }),
      });
      send({ type: "done", text: out.text });
    });
  } catch (e) {
    return fail(e);
  }
}
