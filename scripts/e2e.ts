// End-to-end run against the PayPal sandbox and the configured AI backend.
// npx tsx --env-file=.env.local scripts/e2e.ts
import { contracts, milestones, events, turns } from "../src/lib/db";
import { newContract, SAMPLE_DEAL } from "../src/lib/seed";
import * as flow from "../src/lib/escrow";

const ws = `e2e-${Date.now()}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const c = newContract(ws, SAMPLE_DEAL);
  log("contract", c.id);
  await flow.negotiate(c.id, (e) => {
    if (e.type === "turn") log(`${e.turn.speaker}: ${e.turn.message} [$${e.turn.offer?.totalUsd}${e.turn.accept ? " ACCEPT" : ""}]`);
    if (e.type === "error") log("NEGOTIATION ERROR", e.message);
    if (e.type === "drafted") log("drafted:", e.contract.title, e.contract.summary);
  });
  const ms = milestones.forContract(c.id);
  for (const m of ms) log(`M${m.idx + 1} ${m.title} $${m.amountUsd} day ${m.dueDays}\n   ${m.criteria.map((x) => `${x.id} [${x.check}] ${x.text}`).join("\n   ")}`);
  if (!ms.length) process.exit(1);

  flow.sign(c.id, "client");
  flow.sign(c.id, "freelancer");
  log("status", contracts.get(c.id)!.status);

  const m1 = ms[0];
  const funded = await flow.createFundingOrder(m1.id, { testCard: true });
  log("funded", funded.milestone.status, funded.milestone.paypal.authorizationId);

  const deliverable = process.argv[2];
  const out = await flow.submitWork(
    m1.id,
    deliverable?.startsWith("http") ? { note: "First milestone done", url: deliverable } : { note: "Plan attached", text: deliverable ?? "A one-line plan." },
    (s) => log("stage:", s),
  );
  log("review", out.submission.review?.verdict, out.submission.review?.confidence, out.submission.review?.summary);
  for (const cr of out.submission.review?.criteria ?? []) log(`  ${cr.id} ${cr.met ? "MET" : "NOT MET"} — ${cr.note}`);
  log("milestone", out.milestone.status, JSON.stringify(out.milestone.paypal));

  if (out.milestone.status === "changes_requested") {
    log("opening dispute as freelancer");
    const d = await flow.openDispute(m1.id, "freelancer", "I delivered what we agreed; the reviewer is being too strict.");
    log("ruling", d.dispute?.ruling?.freelancerShare, d.dispute?.ruling?.rationale);
    await flow.acceptRuling(m1.id, "client");
    const s = await flow.acceptRuling(m1.id, "freelancer");
    log("settled", s.status, JSON.stringify(s.paypal));
  }
  await new Promise((r) => setTimeout(r, 8000)); // receipt invoice runs in the background
  for (const e of events.forContract(c.id)) log("ledger", e.type, e.amountUsd ?? "", e.detail);
  log("turns", turns.forContract(c.id).length);
}
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
