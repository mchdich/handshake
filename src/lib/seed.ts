import { contracts, events, newId, type Contract } from "./db";

export const DEMO_FREELANCER_EMAIL =
  process.env.HANDSHAKE_DEMO_FREELANCER_EMAIL ?? "leo.okafor@personal.example.com";

export const SAMPLE_DEAL = {
  client: { name: "Maya Reyes", email: "maya@crumbandco.example", business: "Crumb & Co. Bakery" },
  freelancer: { name: "Leo Okafor", paypalEmail: DEMO_FREELANCER_EMAIL, skills: "web developer, Next.js, 6 years" },
  brief:
    "Our neighborhood bakery needs a one-page website: our menu with prices, opening hours, where to find us, and a form so customers can pre-order custom cakes. Most of our customers are on their phones.",
  clientLimits: {
    budgetUsd: 1200,
    deadlineDays: 21,
    mustHaves: "Works well on phones; menu shows prices; cake pre-order form",
  },
  freelancerLimits: {
    minUsd: 900,
    minDays: 10,
    notes: "Prefers 3 milestones and a small first one. Won't do logo design.",
  },
};

export function newContract(ws: string, input: typeof SAMPLE_DEAL): Contract {
  const c: Contract = {
    id: newId(),
    ws,
    createdAt: Date.now(),
    title: `${input.client.business} × ${input.freelancer.name}`,
    status: "negotiating",
    client: input.client,
    freelancer: input.freelancer,
    brief: input.brief,
    clientLimits: input.clientLimits,
    freelancerLimits: input.freelancerLimits,
    signed: {},
  };
  contracts.save(c);
  events.add({ ws, contractId: c.id, type: "contract.created", actor: "client", detail: `New deal: ${input.brief.slice(0, 120)}` });
  return c;
}

const seeded = new Set<string>();

/** A fresh workspace starts with one ready-to-negotiate deal so there's something to click. */
export function ensureSeed(ws: string) {
  if (seeded.has(ws)) return;
  seeded.add(ws);
  if (contracts.list(ws).length === 0) newContract(ws, SAMPLE_DEAL);
}
