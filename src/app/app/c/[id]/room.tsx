"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleDashed, FileText, Gavel, ImageIcon, Link2, Lock, PenLine, ShieldCheck, X } from "lucide-react";
import { ago, api, stream, usd, usd2 } from "@/lib/client";
import type { Contract, LedgerEvent, Milestone, Party, Review, Submission, Turn } from "@/lib/db";
import { Button, Card, cx, Field, inputCls, Label, Spinner, StatusPill } from "@/components/ui";
import { MoneyBar } from "@/components/money-bar";
import { PayPalFund } from "@/components/paypal-fund";

type M = Milestone & { submissions: Submission[] };
type Data = { contract: Contract; milestones: M[]; turns: Turn[]; events: LedgerEvent[] };

export function Room({ id }: { id: string }) {
  const search = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Party>("client");
  const [live, setLive] = useState<{ turns: Turn[]; thinking: string | null } | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/contracts/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep fresh while something is moving elsewhere (another tab, PayPal webhook).
  useEffect(() => {
    const busy = data?.milestones.some((m) => m.status === "in_review") || data?.contract.status === "negotiating";
    if (!busy || live) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data, live, load]);

  const negotiate = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setLive({ turns: [], thinking: "client" });
    try {
      await stream(`/api/contracts/${id}/negotiate`, {}, (e) => {
        if (e.type === "thinking") setLive((l) => ({ turns: l?.turns ?? [], thinking: e.speaker as string }));
        if (e.type === "turn") setLive((l) => ({ turns: [...(l?.turns ?? []), e.turn as Turn], thinking: null }));
        if (e.type === "error") setError(e.message as string);
      });
    } catch (e) {
      setError((e as Error).message);
    }
    setLive(null);
    started.current = false;
    load();
  }, [id, load]);

  useEffect(() => {
    if (search.get("negotiate") && data?.contract.status === "negotiating" && data.turns.length === 0 && !started.current) {
      negotiate();
    }
  }, [search, data, negotiate]);

  if (error && !data) return <p className="text-bad">{error}</p>;
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-line/50" />;

  const { contract: c, milestones } = data;
  const turns = live ? live.turns : data.turns;
  const total = c.totalUsd ?? c.clientLimits.budgetUsd;
  const me = role === "client" ? c.client.name : c.freelancer.name;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="text-xs text-ink-3">
            {c.client.business} · {c.client.name} <span className="mx-1">⇄</span> {c.freelancer.name}
          </div>
          <h1 className="mt-1 font-display text-4xl leading-tight">{c.title}</h1>
          <p className="mt-2 text-sm text-ink-2">{c.summary ?? c.brief}</p>
        </div>
        <RoleSwitch c={c} role={role} setRole={setRole} />
      </div>

      {milestones.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {usd(total)} <span className="font-normal text-ink-3">over {milestones.length} milestones</span>
            </span>
            <Legend />
          </div>
          <MoneyBar milestones={milestones} total={total} />
        </Card>
      )}

      {error && <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          {c.status === "proposed" && <SignBar c={c} role={role} me={me} onDone={load} />}
          {milestones.map((m) => (
            <MilestoneCard key={m.id} c={c} m={m} role={role} onChange={load} />
          ))}
          {milestones.length === 0 && (
            <Card className="p-6 text-sm text-ink-2">
              Milestones appear here once the two agents agree. Each one gets its own PayPal hold and its own acceptance
              criteria.
            </Card>
          )}
        </div>
        <div className="space-y-4 lg:col-span-5">
          <Negotiation c={c} turns={turns} thinking={live?.thinking ?? null} onStart={negotiate} running={!!live} />
          <Activity events={data.events} />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("h-2 w-2 rounded-full", cls)} />
      {label}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-3 text-xs text-ink-3">
      {item("bg-paid", "paid")}
      {item("bg-held", "held by PayPal")}
      {item("bg-warn", "needs attention")}
      {item("bg-line-2", "not funded")}
    </span>
  );
}

function RoleSwitch({ c, role, setRole }: { c: Contract; role: Party; setRole: (p: Party) => void }) {
  return (
    <div
      className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-card/95 p-1 text-sm shadow-lg shadow-ink/10 backdrop-blur"
      role="tablist"
      aria-label="View as"
    >
      <span className="pl-3 pr-1 text-xs text-ink-3">Viewing as</span>
      {(["client", "freelancer"] as Party[]).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={role === p}
          onClick={() => setRole(p)}
          className={cx("rounded-full px-3.5 py-1.5 transition-colors", role === p ? "bg-ink text-paper" : "text-ink-2 hover:bg-line/60")}
        >
          {p === "client" ? c.client.name.split(" ")[0] : c.freelancer.name.split(" ")[0]}
          <span className={cx("ml-1.5 text-xs", role === p ? "text-paper/60" : "text-ink-3")}>{p}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- negotiation ----------

function Negotiation({
  c,
  turns,
  thinking,
  onStart,
  running,
}: {
  c: Contract;
  turns: Turn[];
  thinking: string | null;
  onStart: () => void;
  running: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns.length, thinking]);
  const name = (s: string) => (s === "client" ? c.client.name.split(" ")[0] : s === "freelancer" ? c.freelancer.name.split(" ")[0] : "Drafter");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Agent negotiation</div>
          <div className="text-xs text-ink-3">Each agent holds its owner&apos;s private limits</div>
        </div>
        {c.status === "negotiating" && !running && (
          <Button size="sm" onClick={onStart}>
            {turns.length ? "Try again" : "Start negotiation"}
          </Button>
        )}
      </div>
      <div className="max-h-[520px] space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && !thinking && (
          <div className="space-y-2 text-sm text-ink-2">
            <MandateRow icon="client" label={`${name("client")}'s agent`} text={`budget ≤ ${usd(c.clientLimits.budgetUsd)}, done in ${c.clientLimits.deadlineDays} days`} />
            <MandateRow icon="freelancer" label={`${name("freelancer")}'s agent`} text={`at least ${usd(c.freelancerLimits.minUsd)}, needs ${c.freelancerLimits.minDays}+ days`} />
            <p className="pt-1 text-xs text-ink-3">Limits are enforced in code: an agent&apos;s offer outside its mandate is rejected before the other side sees it.</p>
          </div>
        )}
        {turns.map((t) =>
          t.speaker === "drafter" ? (
            <div key={t.id} className="rise rounded-xl border border-dashed border-line-2 bg-paper px-3.5 py-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <FileText size={12} /> Contract drafted
              </div>
              {t.message}
            </div>
          ) : (
            <div key={t.id} className={cx("rise flex", t.speaker === "freelancer" && "justify-end")}>
              <div className={cx("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm", t.speaker === "client" ? "rounded-tl-sm bg-paper" : "rounded-tr-sm bg-ink text-paper")}>
                <div className={cx("mb-1 text-[11px] font-medium", t.speaker === "client" ? "text-ink-3" : "text-paper/60")}>
                  {name(t.speaker)}&apos;s agent
                </div>
                <p>{t.message}</p>
                {t.offer && (
                  <div className={cx("mt-2 rounded-lg px-2.5 py-2 text-xs", t.speaker === "client" ? "bg-card" : "bg-white/10")}>
                    <div className="flex items-center justify-between font-semibold tabular">
                      <span>{usd(t.offer.totalUsd)}</span>
                      {t.accept && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-paid px-2 py-0.5 text-[10px] font-semibold text-white">
                          <Check size={10} /> Accepted
                        </span>
                      )}
                    </div>
                    <ul className="mt-1 space-y-0.5 opacity-80">
                      {t.offer.milestones.map((m, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="truncate">{m.title}</span>
                          <span className="tabular shrink-0">
                            {usd(m.amountUsd)} · d{m.dueDays}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className={cx("flex items-center gap-2 text-xs text-ink-3", thinking === "freelancer" && "justify-end")}>
            {name(thinking)}
            {thinking === "drafter" ? " is writing the contract" : "'s agent is thinking"}
            <span className="typing inline-flex gap-0.5">
              <span>●</span>
              <span>●</span>
              <span>●</span>
            </span>
          </div>
        )}
        {c.negotiationError && !running && <p className="text-sm text-bad">{c.negotiationError}</p>}
        <div ref={end} />
      </div>
    </Card>
  );
}

function MandateRow({ label, text }: { icon: string; label: string; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Lock size={12} className="text-ink-3" /> {label}
      </span>
      <span className="text-xs text-ink-2">{text}</span>
    </div>
  );
}

// ---------- signing ----------

function SignBar({ c, role, me, onDone }: { c: Contract; role: Party; me: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedByMe = !!c.signed[role];
  return (
    <Card className="border-seal/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-semibold">Ready to sign</div>
          <p className="text-sm text-ink-2">Review the milestones and criteria below. Funding opens once both sides sign.</p>
          <div className="mt-2 flex gap-3 text-xs text-ink-2">
            {(["client", "freelancer"] as Party[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1">
                {c.signed[p] ? <Check size={12} className="text-paid" /> : <CircleDashed size={12} className="text-ink-3" />}
                {p === "client" ? c.client.name : c.freelancer.name}
              </span>
            ))}
          </div>
        </div>
        <Button
          disabled={signedByMe}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/contracts/${c.id}/sign`, { party: role });
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <PenLine size={15} /> {signedByMe ? "Signed" : `Sign as ${me.split(" ")[0]}`}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}

// ---------- milestones ----------

function MilestoneCard({ c, m, role, onChange }: { c: Contract; m: M; role: Party; onChange: () => void }) {
  const review = m.review;
  const freelancer = c.freelancer.name.split(" ")[0];
  const client = c.client.name.split(" ")[0];
  return (
    <Card className="rise overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-3">
            Milestone {m.idx + 1} · due day {m.dueDays}
            {m.attempts > 0 && ` · ${m.attempts} ${m.attempts === 1 ? "delivery" : "deliveries"}`}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold leading-snug">{m.title}</h3>
          <p className="mt-1 text-sm text-ink-2">{m.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="tabular text-xl font-semibold">{usd(m.amountUsd)}</div>
          <StatusPill status={m.status} />
        </div>
      </div>

      <div className="px-5 py-4">
        <Label>Acceptance criteria</Label>
        <ul className="mt-2 space-y-2">
          {m.criteria.map((cr) => {
            const r = review?.criteria.find((x) => x.id === cr.id);
            return (
              <li key={cr.id} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 shrink-0">
                  {r ? (
                    r.met ? (
                      <Check size={16} className="text-paid" aria-label="met" />
                    ) : (
                      <X size={16} className="text-bad" aria-label="not met" />
                    )
                  ) : (
                    <CircleDashed size={16} className="text-ink-3" aria-label="not reviewed" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cx(r && !r.met && "text-ink")}>{cr.text}</span>
                  {r && (
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {r.note}
                      {r.evidence && <span className="ml-1 font-mono text-[11px] text-ink-2">“{r.evidence.slice(0, 160)}”</span>}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <ReviewerView m={m} />

      <div className="border-t border-line bg-paper/60 px-5 py-4">
        {m.status === "draft" && <p className="text-sm text-ink-3">Opens for funding once both sides sign.</p>}

        {m.status === "awaiting_funding" &&
          (role === "client" ? (
            <PayPalFund milestoneId={m.id} amount={usd2(m.amountUsd)} onFunded={onChange} />
          ) : (
            <p className="text-sm text-ink-2">Waiting for {client} to fund this milestone. Start work once PayPal is holding the money.</p>
          ))}

        {(m.status === "funded" || m.status === "changes_requested") && (
          <>
            {m.status === "changes_requested" && review && <ReviewSummary review={review} />}
            {role === "freelancer" ? (
              <Deliver m={m} onChange={onChange} />
            ) : (
              <p className="flex items-start gap-2 text-sm text-ink-2">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-held" />
                <span>
                  {usd2(m.amountUsd)} is held by PayPal. It&apos;s released to {freelancer} automatically when the delivery meets every criterion above.
                </span>
              </p>
            )}
            {m.status === "changes_requested" && <DisputeOpener m={m} role={role} onChange={onChange} />}
          </>
        )}

        {m.status === "in_review" && (
          <p className="flex items-center gap-2 text-sm text-held">
            <Spinner /> The review agent is checking the delivery…
          </p>
        )}

        {m.status === "disputed" && <DisputePanel c={c} m={m} role={role} onChange={onChange} />}

        {["released", "settled", "refunded"].includes(m.status) && <Receipt c={c} m={m} />}
      </div>
    </Card>
  );
}

/** The screenshots the review agent actually looked at, for the latest delivery. */
function ReviewerView({ m }: { m: M }) {
  const s = [...m.submissions].reverse().find((x) => x.shots?.length && x.review);
  if (!s || !["changes_requested", "released", "disputed", "settled"].includes(m.status)) return null;
  return (
    <div className="px-5 pb-4">
      <Label>What the review agent saw</Label>
      <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
        {s.shots!.map((shot, i) => {
          const phone = shot.label.includes("phone");
          return (
            <figure key={i} className="shrink-0">
              <div className={cx("overflow-y-auto rounded-xl border border-line bg-paper", phone ? "h-72 w-40" : "h-72 w-[22rem]")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/submissions/${s.id}/shot/${i}`} alt={`Screenshot at ${shot.label}`} className="w-full" />
              </div>
              <figcaption className="mt-1 text-[11px] text-ink-3">{shot.label}</figcaption>
            </figure>
          );
        })}
        {s.url && (
          <a href={s.url} target="_blank" rel="noopener" className="self-end whitespace-nowrap pb-5 text-xs text-ink-2 underline-offset-4 hover:underline">
            Open delivery ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ReviewSummary({ review }: { review: Review }) {
  return (
    <div className="mb-4 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm">
      <div className="font-medium text-warn">Not yet — {review.summary}</div>
      {review.missing.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
          {review.missing.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Deliver({ m, onChange }: { m: M; onChange: () => void }) {
  const [mode, setMode] = useState<"link" | "text" | "image">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState<{ name: string; mediaType: string; data: string } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return setError("Images up to 5 MB.");
    const buf = await f.arrayBuffer();
    let bin = "";
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    setImage({ name: f.name, mediaType: f.type, data: btoa(bin) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStage("Sending");
    const body = {
      note,
      ...(mode === "link" && url ? { url } : {}),
      ...(mode === "text" && text ? { text } : {}),
      ...(mode === "image" && image ? { image } : {}),
    };
    try {
      await stream(`/api/milestones/${m.id}/submit`, body, (ev) => {
        if (ev.type === "stage") setStage(ev.stage as string);
        if (ev.type === "error") setError(ev.message as string);
      });
    } catch (err) {
      setError((err as Error).message);
    }
    setStage(null);
    onChange();
  }

  if (stage) {
    return (
      <div className="flex items-center gap-2 text-sm text-held">
        <Spinner /> {stage}…
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{m.status === "changes_requested" ? "Deliver again" : "Deliver the work"}</div>
        <div className="flex gap-1 rounded-full border border-line bg-card p-0.5 text-xs">
          {([
            ["link", Link2, "Link"],
            ["text", FileText, "Text"],
            ["image", ImageIcon, "Image"],
          ] as const).map(([k, Icon, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setMode(k)}
              className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1", mode === k ? "bg-ink text-paper" : "text-ink-2")}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "link" && (
        <input className={inputCls} type="url" required placeholder="https://… (live site, GitHub PR or repo, file)" value={url} onChange={(e) => setUrl(e.target.value)} />
      )}
      {mode === "text" && (
        <textarea className={`${inputCls} min-h-28`} required placeholder="Paste the document or copy" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      {mode === "image" && (
        <input className={inputCls} type="file" accept="image/png,image/jpeg,image/webp" required onChange={(e) => onFile(e.target.files?.[0])} />
      )}
      <input className={inputCls} placeholder="Note for the reviewer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">The review agent opens it, checks each criterion and releases the money if all pass.</p>
        <Button type="submit">Submit for review</Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}

function DisputeOpener({ m, role, onChange }: { m: M; role: Party; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm text-ink-2 underline-offset-4 hover:underline">
        <Gavel size={14} /> Disagree? Ask the mediator for a fair split
      </button>
    );
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-line bg-card p-4">
      <Field label={`Why do you disagree, as the ${role}?`}>
        <textarea className={`${inputCls} min-h-20`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Be specific: which criterion, and what the reviewer missed." />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          busy={busy}
          disabled={!reason.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/api/milestones/${m.id}/dispute`, { party: role, reason });
              onChange();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Mediator is weighing the evidence" : "Open mediation"}
        </Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function DisputePanel({ c, m, role, onChange }: { c: Contract; m: M; role: Party; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = m.dispute!;
  const r = d.ruling;
  if (!r) return <p className="flex items-center gap-2 text-sm text-warn"><Spinner /> The mediator is weighing the evidence…</p>;
  const toFreelancer = Math.round(m.amountUsd * r.freelancerShare * 100) / 100;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Gavel size={15} /> Mediator&apos;s proposal
        </div>
        <p className="mt-1 text-sm text-ink-2">{r.rationale}</p>
      </div>
      <div>
        <div className="flex h-8 overflow-hidden rounded-lg text-xs font-medium">
          <div className="flex items-center bg-paid px-2 text-white" style={{ width: `${Math.max(r.freelancerShare * 100, 12)}%` }}>
            {c.freelancer.name.split(" ")[0]} {usd2(toFreelancer)}
          </div>
          <div className="flex flex-1 items-center justify-end bg-held-soft px-2 text-held">
            back to {c.client.name.split(" ")[0]} {usd2(m.amountUsd - toFreelancer)}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-ink-3">
          If both accept, PayPal captures {usd2(toFreelancer)} from the hold and releases the rest. No refund wait.
        </p>
      </div>
      <ul className="space-y-1 text-xs text-ink-2">
        {r.criteriaFindings.map((f) => (
          <li key={f.id}>
            <span className={cx("mr-1.5 font-semibold", f.met === "yes" ? "text-paid" : f.met === "partly" ? "text-warn" : "text-bad")}>
              {f.met}
            </span>
            {m.criteria.find((x) => x.id === f.id)?.text ?? f.id} — {f.note}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 text-xs text-ink-2">
          {(["client", "freelancer"] as Party[]).map((p) => (
            <span key={p} className="inline-flex items-center gap-1">
              {d.accepted[p] ? <Check size={12} className="text-paid" /> : <CircleDashed size={12} className="text-ink-3" />}
              {p === "client" ? c.client.name : c.freelancer.name}
            </span>
          ))}
        </div>
        <Button
          size="sm"
          disabled={!!d.accepted[role]}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/api/milestones/${m.id}/accept`, { party: role });
              onChange();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {d.accepted[role] ? "Accepted" : "Accept split"}
        </Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function Receipt({ c, m }: { c: Contract; m: M }) {
  const p = m.paypal;
  if (m.status === "refunded") {
    return <p className="text-sm text-ink-2">The {usd2(m.amountUsd)} hold was voided; {c.client.name.split(" ")[0]} was never charged.</p>;
  }
  const rows: [string, string][] = [
    ["Captured from hold", usd2(p.capturedUsd)],
    ["PayPal fee", usd2(p.feeUsd)],
    [`Paid to ${c.freelancer.name.split(" ")[0]}`, usd2(p.payoutUsd)],
  ];
  if (m.status === "settled") rows.splice(1, 0, ["Released back to client", usd2(m.amountUsd - (p.capturedUsd ?? 0))]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-paid">
        <Check size={16} /> {m.status === "settled" ? "Settled by agreement" : "Verified and paid"}
        {m.review && m.status === "released" && <span className="font-normal text-ink-3">· {Math.round(m.review.confidence * 100)}% confidence</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="tabular font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
        {p.captureId && <span>capture {p.captureId}</span>}
        {p.payoutBatchId && (
          <span>
            payout {p.payoutBatchId} ({p.payoutStatus?.toLowerCase()})
          </span>
        )}
        {p.invoiceId && <span>invoice {p.invoiceId}</span>}
      </div>
    </div>
  );
}

// ---------- activity ----------

const ACTOR: Record<string, string> = {
  client: "Client",
  freelancer: "Freelancer",
  paypal: "PayPal",
  handshake: "Handshake",
  "agent:negotiators": "Agents",
  "agent:reviewer": "Review agent",
  "agent:mediator": "Mediator",
  "agent:paypal-toolkit": "PayPal Agent Toolkit",
};

function Activity({ events }: { events: LedgerEvent[] }) {
  if (!events.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-semibold">Activity</div>
      <ol className="max-h-[480px] space-y-2.5 overflow-y-auto pr-1">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span
              className={cx(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                e.type.startsWith("payout") || e.type === "review.passed" || e.type === "invoice.issued" ? "bg-paid" : e.type.startsWith("funds") ? "bg-held" : e.type.includes("fail") || e.type.startsWith("dispute") ? "bg-warn" : "bg-line-2",
              )}
            />
            <div className="min-w-0">
              <div className="text-ink">{e.detail}</div>
              <div className="text-xs text-ink-3">
                {ACTOR[e.actor] ?? e.actor} · {ago(e.at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
