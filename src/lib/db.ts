import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";

export const newId = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 12);

const file = process.env.HANDSHAKE_DB ?? path.join(process.cwd(), "data", "handshake.db");
fs.mkdirSync(path.dirname(file), { recursive: true });

declare global {
  var __handshakeDb: Database.Database | undefined;
}

export const db = globalThis.__handshakeDb ?? new Database(file, { timeout: 15000 });
globalThis.__handshakeDb = db;
db.pragma("busy_timeout = 15000");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  ws TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_ws ON contracts(ws);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS milestones_contract ON milestones(contract_id);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ws TEXT NOT NULL,
  contract_id TEXT,
  milestone_id TEXT,
  at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ws ON events(ws, at);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  data TEXT NOT NULL
);
`);

// ---------- types ----------

export type Party = "client" | "freelancer";

export type Criterion = {
  id: string;
  text: string;
  /** How the reviewer checks it: automated evidence vs judgment. */
  check: "evidence" | "judgment";
};

export type ContractStatus = "negotiating" | "proposed" | "active" | "completed" | "cancelled";

export type Contract = {
  id: string;
  ws: string;
  createdAt: number;
  title: string;
  status: ContractStatus;
  client: { name: string; email: string; business: string };
  freelancer: { name: string; paypalEmail: string; skills: string };
  brief: string;
  clientLimits: { budgetUsd: number; deadlineDays: number; mustHaves: string };
  freelancerLimits: { minUsd: number; minDays: number; notes: string };
  summary?: string;
  totalUsd?: number;
  signed: { client?: number; freelancer?: number };
  negotiationError?: string;
};

export type MilestoneStatus =
  | "draft"
  | "awaiting_funding"
  | "funded"
  | "in_review"
  | "changes_requested"
  | "disputed"
  | "released"
  | "settled"
  | "refunded";

export type Review = {
  at: number;
  verdict: "pass" | "fail";
  confidence: number;
  summary: string;
  criteria: { id: string; met: boolean; evidence: string; note: string }[];
  missing: string[];
  model: string;
};

export type Dispute = {
  openedBy: Party;
  reason: string;
  at: number;
  ruling?: {
    at: number;
    freelancerShare: number; // 0..1 of the milestone amount
    rationale: string;
    criteriaFindings: { id: string; met: "yes" | "partly" | "no"; note: string }[];
  };
  accepted: { client?: number; freelancer?: number };
};

export type Milestone = {
  id: string;
  contractId: string;
  idx: number;
  title: string;
  description: string;
  amountUsd: number;
  dueDays: number;
  criteria: Criterion[];
  status: MilestoneStatus;
  paypal: {
    orderId?: string;
    authorizationId?: string;
    authorizationExpires?: string;
    payerEmail?: string;
    captureId?: string;
    capturedUsd?: number;
    feeUsd?: number;
    netUsd?: number;
    payoutBatchId?: string;
    payoutStatus?: string;
    payoutUsd?: number;
    invoiceId?: string;
  };
  review?: Review;
  dispute?: Dispute;
  attempts: number;
};

export type Submission = {
  id: string;
  milestoneId: string;
  createdAt: number;
  note: string;
  url?: string;
  text?: string;
  image?: { mediaType: string; data: string; name: string };
  /** Browser screenshots the reviewer looked at (JPEG, base64). */
  shots?: { label: string; data: string }[];
  review?: Review;
};

export type EventType =
  | "contract.created"
  | "contract.proposed"
  | "contract.signed"
  | "contract.active"
  | "contract.completed"
  | "funds.held"
  | "work.submitted"
  | "review.passed"
  | "review.failed"
  | "funds.captured"
  | "payout.sent"
  | "payout.updated"
  | "funds.released_back"
  | "dispute.opened"
  | "dispute.ruled"
  | "dispute.settled"
  | "invoice.issued"
  | "webhook";

export type LedgerEvent = {
  id: string;
  ws: string;
  contractId?: string;
  milestoneId?: string;
  at: number;
  type: EventType;
  actor: string;
  amountUsd?: number;
  ref?: string;
  detail: string;
};

export type Turn = {
  id: string;
  contractId: string;
  idx: number;
  speaker: Party | "drafter";
  message: string;
  offer?: OfferTerms;
  accept?: boolean;
};

export type OfferTerms = {
  totalUsd: number;
  milestones: { title: string; description: string; amountUsd: number; dueDays: number }[];
};

// ---------- repos ----------

const row = <T>(r: { data: string } | undefined) => (r ? (JSON.parse(r.data) as T) : undefined);

export const contracts = {
  get(id: string) {
    return row<Contract>(db.prepare("SELECT data FROM contracts WHERE id = ?").get(id) as never);
  },
  list(ws: string) {
    return (db.prepare("SELECT data FROM contracts WHERE ws = ? ORDER BY created_at DESC").all(ws) as {
      data: string;
    }[]).map((r) => JSON.parse(r.data) as Contract);
  },
  save(c: Contract) {
    db.prepare(
      "INSERT INTO contracts (id, ws, created_at, data) VALUES (@id, @ws, @createdAt, @data) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run({ id: c.id, ws: c.ws, createdAt: c.createdAt, data: JSON.stringify(c) });
    return c;
  },
};

export const milestones = {
  get(id: string) {
    return row<Milestone>(db.prepare("SELECT data FROM milestones WHERE id = ?").get(id) as never);
  },
  forContract(contractId: string) {
    return (db.prepare("SELECT data FROM milestones WHERE contract_id = ? ORDER BY idx").all(contractId) as {
      data: string;
    }[]).map((r) => JSON.parse(r.data) as Milestone);
  },
  save(m: Milestone) {
    db.prepare(
      "INSERT INTO milestones (id, contract_id, idx, data) VALUES (@id, @contractId, @idx, @data) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run({ id: m.id, contractId: m.contractId, idx: m.idx, data: JSON.stringify(m) });
    return m;
  },
  deleteForContract(contractId: string) {
    db.prepare("DELETE FROM milestones WHERE contract_id = ?").run(contractId);
  },
};

export const submissions = {
  get(id: string) {
    const r = db.prepare("SELECT data FROM submissions WHERE id = ?").get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Submission) : undefined;
  },
  forMilestone(milestoneId: string) {
    return (db
      .prepare("SELECT data FROM submissions WHERE milestone_id = ? ORDER BY created_at")
      .all(milestoneId) as { data: string }[]).map((r) => JSON.parse(r.data) as Submission);
  },
  save(s: Submission) {
    db.prepare(
      "INSERT INTO submissions (id, milestone_id, created_at, data) VALUES (@id, @milestoneId, @createdAt, @data) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run({ id: s.id, milestoneId: s.milestoneId, createdAt: s.createdAt, data: JSON.stringify(s) });
    return s;
  },
};

export const turns = {
  forContract(contractId: string) {
    return (db.prepare("SELECT data FROM turns WHERE contract_id = ? ORDER BY idx").all(contractId) as {
      data: string;
    }[]).map((r) => JSON.parse(r.data) as Turn);
  },
  add(t: Omit<Turn, "id">) {
    const full = { ...t, id: newId() };
    db.prepare("INSERT INTO turns (id, contract_id, idx, data) VALUES (?, ?, ?, ?)").run(
      full.id,
      t.contractId,
      t.idx,
      JSON.stringify(full),
    );
    return full;
  },
  clear(contractId: string) {
    db.prepare("DELETE FROM turns WHERE contract_id = ?").run(contractId);
  },
};

export const events = {
  add(e: Omit<LedgerEvent, "id" | "at"> & { at?: number }) {
    const full: LedgerEvent = { ...e, id: newId(), at: e.at ?? Date.now() };
    db.prepare(
      "INSERT INTO events (id, ws, contract_id, milestone_id, at, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(full.id, full.ws, full.contractId ?? null, full.milestoneId ?? null, full.at, JSON.stringify(full));
    return full;
  },
  list(ws: string) {
    return (db.prepare("SELECT data FROM events WHERE ws = ? ORDER BY at DESC").all(ws) as {
      data: string;
    }[]).map((r) => JSON.parse(r.data) as LedgerEvent);
  },
  forContract(contractId: string) {
    return (db.prepare("SELECT data FROM events WHERE contract_id = ? ORDER BY at").all(contractId) as {
      data: string;
    }[]).map((r) => JSON.parse(r.data) as LedgerEvent);
  },
};

export const webhookLog = {
  add(id: string, verified: boolean, body: unknown) {
    db.prepare(
      "INSERT OR IGNORE INTO webhook_events (id, at, verified, data) VALUES (?, ?, ?, ?)",
    ).run(id, Date.now(), verified ? 1 : 0, JSON.stringify(body));
  },
};

/** Find the milestone a PayPal resource belongs to (webhooks). */
export function milestoneByPayPalRef(ref: string): Milestone | undefined {
  const r = db
    .prepare(
      `SELECT data FROM milestones WHERE
        json_extract(data, '$.paypal.orderId') = @ref OR
        json_extract(data, '$.paypal.authorizationId') = @ref OR
        json_extract(data, '$.paypal.captureId') = @ref OR
        json_extract(data, '$.paypal.payoutBatchId') = @ref OR
        id = @ref`,
    )
    .get({ ref }) as { data: string } | undefined;
  return row<Milestone>(r);
}
