// The money flow. Every state change goes through here so the ledger and PayPal never disagree.

import {
  contracts,
  events,
  milestones,
  newId,
  submissions,
  turns,
  type Contract,
  type Milestone,
  type Party,
  type Submission,
} from "./db";
import * as pp from "./paypal";
import { draftContract, mediate, negotiatorTurn, reviewSubmission } from "./agents";
import { gatherEvidence } from "./evidence";
import { issueReceipt } from "./paypal-agent";

const MAX_TURNS = 8;
const round2 = (n: number) => Math.round(n * 100) / 100;

export class FlowError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function need(m: Milestone | undefined): Milestone {
  if (!m) throw new FlowError("Milestone not found", 404);
  return m;
}
function needContract(id: string): Contract {
  const c = contracts.get(id);
  if (!c) throw new FlowError("Contract not found", 404);
  return c;
}

// ---------- negotiation ----------

export type NegotiationEvent =
  | { type: "turn"; turn: ReturnType<typeof turns.add> }
  | { type: "thinking"; speaker: Party | "drafter" }
  | { type: "drafted"; contract: Contract; milestones: Milestone[] }
  | { type: "error"; message: string };

export async function negotiate(contractId: string, emit: (e: NegotiationEvent) => void) {
  const c = needContract(contractId);
  if (c.status !== "negotiating") throw new FlowError("This contract is already negotiated.");
  turns.clear(c.id);
  const history = [] as ReturnType<typeof turns.forContract>;
  let agreed: (typeof history)[number]["offer"] | undefined;
  try {
    for (let i = 0; i < MAX_TURNS && !agreed; i++) {
      const side: Party = i % 2 === 0 ? "client" : "freelancer";
      emit({ type: "thinking", speaker: side });
      const t = await negotiatorTurn(side, c, history);
      const saved = turns.add({
        contractId: c.id,
        idx: i,
        speaker: side,
        message: t.message,
        offer: t.offer,
        accept: t.accept,
      });
      history.push(saved);
      emit({ type: "turn", turn: saved });
      if (t.accept) agreed = t.offer;
    }
    if (!agreed) {
      // No handshake: pick the last offer both mandates allow, else stop.
      throw new FlowError("The agents couldn't agree inside both sets of limits. Adjust the budget or timeline and try again.");
    }
    emit({ type: "thinking", speaker: "drafter" });
    const draft = await draftContract(c, agreed);
    c.title = draft.title;
    c.summary = draft.summary;
    c.totalUsd = round2(agreed.milestones.reduce((a, m) => a + m.amountUsd, 0));
    c.status = "proposed";
    c.negotiationError = undefined;
    contracts.save(c);
    milestones.deleteForContract(c.id);
    const ms = agreed.milestones.map((m, idx) =>
      milestones.save({
        id: newId(),
        contractId: c.id,
        idx,
        title: draft.milestones[idx]?.title ?? m.title,
        description: draft.milestones[idx]?.description ?? m.description,
        amountUsd: round2(m.amountUsd),
        dueDays: m.dueDays,
        criteria: (draft.milestones[idx]?.criteria ?? []).map((cr, j) => ({
          id: `c${j + 1}`,
          text: cr.text,
          check: cr.check,
        })),
        status: "draft",
        paypal: {},
        attempts: 0,
      }),
    );
    turns.add({
      contractId: c.id,
      idx: history.length,
      speaker: "drafter",
      message: draft.summary,
    });
    events.add({
      ws: c.ws,
      contractId: c.id,
      type: "contract.proposed",
      actor: "agent:negotiators",
      amountUsd: c.totalUsd,
      detail: `Agents agreed on $${c.totalUsd} over ${ms.length} milestones in ${history.length} messages`,
    });
    emit({ type: "drafted", contract: c, milestones: ms });
  } catch (e) {
    c.negotiationError = e instanceof Error ? e.message : String(e);
    contracts.save(c);
    emit({ type: "error", message: c.negotiationError });
  }
}

export function sign(contractId: string, party: Party) {
  const c = needContract(contractId);
  if (c.status !== "proposed") throw new FlowError("Nothing to sign yet.");
  c.signed[party] = Date.now();
  events.add({ ws: c.ws, contractId: c.id, type: "contract.signed", actor: party, detail: `${party === "client" ? c.client.name : c.freelancer.name} signed` });
  if (c.signed.client && c.signed.freelancer) {
    c.status = "active";
    for (const m of milestones.forContract(c.id)) milestones.save({ ...m, status: "awaiting_funding" });
    events.add({ ws: c.ws, contractId: c.id, type: "contract.active", actor: "handshake", detail: "Both sides signed — milestones open for funding" });
  }
  return contracts.save(c);
}

// ---------- funding (PayPal hold) ----------

export async function createFundingOrder(milestoneId: string, opts: { testCard?: boolean } = {}) {
  const m = need(milestones.get(milestoneId));
  const c = needContract(m.contractId);
  if (m.status !== "awaiting_funding") throw new FlowError("This milestone isn't waiting for funding.");
  const order = await pp.createEscrowOrder({
    milestoneId: m.id,
    amountUsd: m.amountUsd,
    description: `${c.title} — ${m.title}`,
    requestId: `order-${m.id}-${Date.now()}`,
    testCard: opts.testCard,
  });
  m.paypal.orderId = order.id;
  milestones.save(m);
  if (opts.testCard) {
    // Card orders come back already authorized.
    return { orderId: order.id, milestone: recordHold(m, c, order) };
  }
  return { orderId: order.id, milestone: m };
}

function recordHold(m: Milestone, c: Contract, order: pp.Order) {
  const auth = order.purchase_units[0]?.payments?.authorizations?.[0];
  if (!auth || !["CREATED", "PENDING"].includes(auth.status)) {
    throw new FlowError(`PayPal didn't place the hold (status ${auth?.status ?? order.status}).`);
  }
  m.paypal.authorizationId = auth.id;
  m.paypal.authorizationExpires = auth.expiration_time;
  m.paypal.payerEmail = order.payer?.email_address;
  m.status = "funded";
  milestones.save(m);
  events.add({
    ws: c.ws,
    contractId: c.id,
    milestoneId: m.id,
    type: "funds.held",
    actor: "client",
    amountUsd: m.amountUsd,
    ref: auth.id,
    detail: `$${m.amountUsd} held by PayPal for "${m.title}"`,
  });
  return m;
}

export async function confirmFunding(milestoneId: string, orderId: string) {
  const m = need(milestones.get(milestoneId));
  const c = needContract(m.contractId);
  if (m.paypal.orderId !== orderId) throw new FlowError("Order doesn't match this milestone.");
  if (m.status === "funded") return m;
  const order = await pp.authorizeOrder(orderId, `auth-${orderId}`);
  return recordHold(m, c, order);
}

// ---------- delivery & verification ----------

export async function submitWork(
  milestoneId: string,
  input: Pick<Submission, "note" | "url" | "text" | "image">,
  onStage?: (stage: string) => void,
) {
  const m = need(milestones.get(milestoneId));
  const c = needContract(m.contractId);
  if (!["funded", "changes_requested"].includes(m.status)) {
    throw new FlowError(m.status === "awaiting_funding" ? "The client hasn't funded this milestone yet." : "This milestone isn't open for delivery.");
  }
  if (!input.url && !input.text && !input.image) throw new FlowError("Add a link, some text or an image.");
  const previous = submissions.forMilestone(m.id);
  const s = submissions.save({ id: newId(), milestoneId: m.id, createdAt: Date.now(), ...input });
  m.status = "in_review";
  m.attempts += 1;
  milestones.save(m);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "work.submitted", actor: "freelancer", detail: `Attempt ${m.attempts}: ${input.url ?? input.image?.name ?? "text deliverable"}` });

  try {
    onStage?.("Collecting evidence");
    const evidence = await gatherEvidence(s);
    s.shots = evidence.flatMap((e) => (e.image ? [{ label: e.label.replace(/^Opened in a real browser at /, ""), data: e.image.data }] : []));
    submissions.save(s);
    onStage?.("Checking each criterion");
    const review = await reviewSubmission({ contract: c, milestone: m, submission: s, evidence, previous });
    s.review = review;
    submissions.save(s);
    m.review = review;
    if (review.verdict === "pass") {
      events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "review.passed", actor: "agent:reviewer", detail: `All ${m.criteria.length} criteria met (confidence ${Math.round(review.confidence * 100)}%)` });
      milestones.save(m);
      onStage?.("Releasing payment");
      return { submission: s, milestone: await release(m.id, "Verified by the review agent") };
    }
    m.status = "changes_requested";
    milestones.save(m);
    events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "review.failed", actor: "agent:reviewer", detail: review.missing.map((x) => x.replace(/[.;\s]+$/, "")).join("; ").slice(0, 300) });
    return { submission: s, milestone: m };
  } catch (e) {
    m.status = "funded";
    m.attempts -= 1;
    milestones.save(m);
    throw e;
  }
}

/** Capture the whole hold and pay the freelancer. */
export async function release(milestoneId: string, reason: string) {
  const m = need(milestones.get(milestoneId));
  if (!m.paypal.authorizationId) throw new FlowError("Nothing is held for this milestone.");
  if (m.status === "released") return m;
  return payOut(m, m.amountUsd, reason, "released");
}

async function payOut(m: Milestone, amountUsd: number, reason: string, final: "released" | "settled") {
  const c = needContract(m.contractId);
  const capture = await pp.captureAuthorization({
    authorizationId: m.paypal.authorizationId!,
    amountUsd,
    final: true,
    note: `${c.title}: ${m.title}`,
    requestId: `cap-${m.id}`,
  });
  const fee = Number(capture.seller_receivable_breakdown?.paypal_fee?.value ?? 0);
  const net = Number(capture.seller_receivable_breakdown?.net_amount?.value ?? amountUsd);
  m.paypal.captureId = capture.id;
  m.paypal.capturedUsd = amountUsd;
  m.paypal.feeUsd = fee;
  m.paypal.netUsd = net;
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "funds.captured", actor: "paypal", amountUsd, ref: capture.id, detail: `Captured $${amountUsd.toFixed(2)} (PayPal fee $${fee.toFixed(2)})${amountUsd < m.amountUsd ? `; $${(m.amountUsd - amountUsd).toFixed(2)} released back to the client` : ""}` });

  const batch = await pp.sendPayout({
    batchId: `hs-${m.id}`,
    itemId: m.id,
    receiverEmail: c.freelancer.paypalEmail,
    amountUsd: net,
    note: `${c.title} — ${m.title}. ${reason}.`,
  });
  m.paypal.payoutBatchId = batch.batch_header.payout_batch_id;
  m.paypal.payoutStatus = batch.batch_header.batch_status;
  m.paypal.payoutUsd = net;
  m.status = final;
  milestones.save(m);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "payout.sent", actor: "paypal", amountUsd: net, ref: m.paypal.payoutBatchId, detail: `Paid $${net.toFixed(2)} to ${c.freelancer.paypalEmail}` });

  issueReceipt(c, m).catch((e) => console.warn("receipt invoice failed:", e));
  finishIfDone(c);
  return m;
}

function finishIfDone(c: Contract) {
  const ms = milestones.forContract(c.id);
  if (ms.every((m) => ["released", "settled", "refunded"].includes(m.status)) && c.status !== "completed") {
    c.status = "completed";
    contracts.save(c);
    const paid = ms.reduce((a, m) => a + (m.paypal.capturedUsd ?? 0), 0);
    events.add({ ws: c.ws, contractId: c.id, type: "contract.completed", actor: "handshake", amountUsd: paid, detail: `Contract complete — $${paid.toFixed(2)} paid out` });
  }
}

// ---------- disputes ----------

export async function openDispute(milestoneId: string, party: Party, reason: string) {
  const m = need(milestones.get(milestoneId));
  const c = needContract(m.contractId);
  if (!["changes_requested", "funded", "in_review"].includes(m.status) || !m.paypal.authorizationId) {
    throw new FlowError("Only a funded, unpaid milestone can be disputed.");
  }
  if (!reason.trim()) throw new FlowError("Say what you disagree with.");
  const subs = submissions.forMilestone(m.id);
  m.dispute = { openedBy: party, reason, at: Date.now(), accepted: {} };
  m.status = "disputed";
  milestones.save(m);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "dispute.opened", actor: party, detail: reason.slice(0, 300) });

  const latest = subs.at(-1);
  const evidence = latest ? await gatherEvidence(latest) : [{ label: "Delivery", body: "Nothing was delivered." }];
  const ruling = await mediate({ contract: c, milestone: m, submissions: subs, openedBy: party, reason, evidence });
  m.dispute.ruling = {
    at: Date.now(),
    freelancerShare: ruling.freelancerShare,
    rationale: ruling.rationale,
    criteriaFindings: ruling.criteriaFindings,
  };
  milestones.save(m);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "dispute.ruled", actor: "agent:mediator", amountUsd: round2(m.amountUsd * ruling.freelancerShare), detail: `Proposed ${Math.round(ruling.freelancerShare * 100)}% to the freelancer` });
  return m;
}

export async function acceptRuling(milestoneId: string, party: Party) {
  const m = need(milestones.get(milestoneId));
  if (m.status !== "disputed" || !m.dispute?.ruling) throw new FlowError("No proposal to accept.");
  m.dispute.accepted[party] = Date.now();
  milestones.save(m);
  if (!(m.dispute.accepted.client && m.dispute.accepted.freelancer)) return m;
  const c = needContract(m.contractId);
  const amount = round2(m.amountUsd * m.dispute.ruling.freelancerShare);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "dispute.settled", actor: "handshake", amountUsd: amount, detail: `Both accepted: $${amount.toFixed(2)} to the freelancer, $${(m.amountUsd - amount).toFixed(2)} back to the client` });
  if (amount <= 0) return refund(m.id, "Dispute settled in the client's favour");
  return payOut(m, amount, "Settled by agreement after mediation", "settled");
}

/** Void the hold: the client gets everything back. */
export async function refund(milestoneId: string, reason: string) {
  const m = need(milestones.get(milestoneId));
  const c = needContract(m.contractId);
  if (!m.paypal.authorizationId) throw new FlowError("Nothing is held for this milestone.");
  await pp.voidAuthorization(m.paypal.authorizationId);
  m.status = "refunded";
  milestones.save(m);
  events.add({ ws: c.ws, contractId: c.id, milestoneId: m.id, type: "funds.released_back", actor: "paypal", amountUsd: m.amountUsd, ref: m.paypal.authorizationId, detail: `${reason} — $${m.amountUsd.toFixed(2)} hold voided` });
  finishIfDone(c);
  return m;
}
