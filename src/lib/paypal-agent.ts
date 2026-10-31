// PayPal's official Agent Toolkit (@paypal/agent-toolkit). Its tools do two jobs here:
// 1. issue a paid PayPal invoice as the receipt for every released milestone, and
// 2. give the ops assistant real PayPal tools (invoices, transactions, disputes, orders).

import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { AgentTool } from "./llm";
import { contracts, events, milestones, type Contract, type Milestone } from "./db";

type ToolkitTool = {
  description?: string;
  parameters: ZodTypeAny;
  execute: (args: unknown, opts: unknown) => Promise<unknown>;
};

let toolkit: Record<string, ToolkitTool> | null = null;

export function toolkitTools(): Record<string, ToolkitTool> {
  if (toolkit) return toolkit;
  const tk = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: {
        invoices: { create: true, list: true, get: true, send: true, sendReminder: true, recordPayment: true, generateQRC: true },
        orders: { get: true },
        disputes: { list: true, get: true },
        transactions: { list: true },
      },
      context: { sandbox: (process.env.PAYPAL_API_BASE ?? "").includes("sandbox") },
    },
  });
  toolkit = tk.getTools() as unknown as Record<string, ToolkitTool>;
  return toolkit;
}

async function runTool(name: string, args: Record<string, unknown>) {
  const tool = toolkitTools()[name];
  if (!tool) throw new Error(`PayPal tool ${name} is not enabled`);
  const out = await tool.execute(tool.parameters.parse(args), {});
  const parsed = typeof out === "string" ? safeJson(out) : out;
  // The toolkit reports API failures as returned values, not exceptions.
  if (typeof parsed === "string" && /^error|failed/i.test(parsed)) throw new Error(`${name}: ${parsed.slice(0, 300)}`);
  if (parsed && typeof parsed === "object" && ("error" in parsed || (parsed as { ok?: boolean }).ok === false || (parsed as { name?: string }).name?.endsWith("ERROR"))) {
    throw new Error(`${name}: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// PayPal dates invoices in US Pacific time; a UTC date can be "tomorrow" there, which schedules the invoice instead of issuing it.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** A PayPal invoice, marked paid with the capture, so the client has a real receipt for their books. */
export async function issueReceipt(c: Contract, m: Milestone) {
  const amount = (m.paypal.capturedUsd ?? m.amountUsd).toFixed(2);
  const [given, ...rest] = c.client.name.split(" ");
  const created = (await runTool("create_invoice", {
    currency_code: "USD",
    invoice_date: today(),
    reference: `${c.id}/${m.id}`.slice(0, 120),
    note: (m.status === "settled" && m.dispute?.ruling
      ? `Settled through Handshake mediation: ${Math.round(m.dispute.ruling.freelancerShare * 100)}% of ${m.amountUsd.toFixed(2)} USD, accepted by both parties. ${m.dispute.ruling.rationale}`
      : `Released by Handshake after verification. ${m.review?.summary ?? ""}`
    ).slice(0, 3900),
    invoicer_business_name: c.freelancer.name,
    primary_recipients: [
      {
        billing_info: {
          business_name: c.client.business,
          email_address: c.client.email,
          name: { given_name: given, surname: rest.join(" ") || given },
        },
      },
    ],
    items: [
      {
        name: `${c.title} — ${m.title}`.slice(0, 200),
        description: m.description.slice(0, 1000),
        quantity: "1",
        unit_amount: { currency_code: "USD", value: amount },
      },
    ],
  })) as { href?: string };
  const invoiceId = created.href?.split("/").pop();
  if (!invoiceId) throw new Error(`no invoice id in ${JSON.stringify(created)}`);
  await runTool("send_invoice", { invoice_id: invoiceId, send_to_recipient: false, send_to_invoicer: false });
  await runTool("record_payment_for_invoice", {
    invoice_id: invoiceId,
    method: "PAYPAL",
    // payment_id is for PayPal invoice payments; a capture id there 404s, so it goes in the note.
    payment_date: today(),
    amount: { currency_code: "USD", value: amount },
    note: `Captured from the Handshake PayPal hold (capture ${m.paypal.captureId})`,
  });
  const fresh = milestones.get(m.id);
  if (fresh) milestones.save({ ...fresh, paypal: { ...fresh.paypal, invoiceId } });
  events.add({
    ws: c.ws,
    contractId: c.id,
    milestoneId: m.id,
    type: "invoice.issued",
    actor: "agent:paypal-toolkit",
    amountUsd: Number(amount),
    ref: invoiceId,
    detail: `PayPal invoice ${invoiceId} issued to ${c.client.email} and marked paid`,
  });
  return invoiceId;
}

// ---------- ops assistant tools ----------

const OPS_TOOLKIT = [
  "list_invoices",
  "get_invoice",
  "send_invoice_reminder",
  "generate_invoice_qr_code",
  "list_transactions",
  "list_disputes",
  "get_dispute",
  "get_order",
];

export function opsTools(ws: string): AgentTool[] {
  const tk = toolkitTools();
  const fromToolkit: AgentTool[] = OPS_TOOLKIT.filter((n) => tk[n]).map((name) => {
    const schema = zodToJsonSchema(tk[name].parameters, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name,
      description: `[PayPal Agent Toolkit] ${(tk[name].description ?? name).trim().slice(0, 900)}`,
      inputSchema: schema,
      run: (input) => runTool(name, input),
    };
  });

  const handshake: AgentTool[] = [
    {
      name: "list_contracts",
      description: "[Handshake] This workspace's contracts with every milestone: status, amount, PayPal ids (order, authorization, capture, payout batch, invoice).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () =>
        contracts.list(ws).map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          client: c.client,
          freelancer: { name: c.freelancer.name, paypalEmail: c.freelancer.paypalEmail },
          totalUsd: c.totalUsd,
          milestones: milestones.forContract(c.id).map((m) => ({
            id: m.id,
            title: m.title,
            amountUsd: m.amountUsd,
            status: m.status,
            paypal: m.paypal,
            review: m.review && { verdict: m.review.verdict, summary: m.review.summary },
            dispute: m.dispute && { openedBy: m.dispute.openedBy, share: m.dispute.ruling?.freelancerShare },
          })),
        })),
    },
    {
      name: "ledger",
      description: "[Handshake] Money ledger for this workspace: every hold, capture, payout, refund and invoice event, newest first.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max events (default 50)." } },
        additionalProperties: false,
      },
      run: async (input) => events.list(ws).slice(0, Number(input.limit ?? 50)),
    },
  ];
  return [...handshake, ...fromToolkit];
}
