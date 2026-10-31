"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { api, usd } from "@/lib/client";
import type { Contract, Milestone } from "@/lib/db";
import { Button, Card, Label } from "@/components/ui";
import { MoneyBar } from "@/components/money-bar";

type Row = Contract & { milestones: Milestone[] };

const CONTRACT_STATUS: Record<Contract["status"], string> = {
  negotiating: "Ready to negotiate",
  proposed: "Waiting for signatures",
  active: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Row[]>("/api/contracts").then(setRows, (e) => setError(e.message));
  }, []);

  const held = rows?.flatMap((r) => r.milestones).filter((m) => ["funded", "in_review", "changes_requested", "disputed"].includes(m.status)).reduce((a, m) => a + m.amountUsd, 0) ?? 0;
  const paid = rows?.flatMap((r) => r.milestones).reduce((a, m) => a + (m.paypal.payoutUsd ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Your deals</h1>
          <p className="mt-1 text-sm text-ink-2">Every milestone is held by PayPal and paid the moment the work checks out.</p>
        </div>
        <Link href="/app/new">
          <Button>
            <Plus size={16} /> New deal
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <Label>Held by PayPal</Label>
          <div className="tabular mt-1 text-2xl font-semibold text-held">{usd(held)}</div>
        </Card>
        <Card className="p-4">
          <Label>Paid to freelancers</Label>
          <div className="tabular mt-1 text-2xl font-semibold text-paid">{usd(paid)}</div>
        </Card>
        <Card className="p-4">
          <Label>Deals</Label>
          <div className="tabular mt-1 text-2xl font-semibold">{rows?.length ?? "—"}</div>
        </Card>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {!rows && !error && <div className="h-32 animate-pulse rounded-2xl bg-line/50" />}

      <div className="grid gap-4 md:grid-cols-2">
        {rows?.map((c) => {
          const total = c.totalUsd ?? c.clientLimits.budgetUsd;
          const done = c.milestones.filter((m) => ["released", "settled"].includes(m.status)).length;
          return (
            <Link key={c.id} href={`/app/c/${c.id}`} className="group">
              <Card className="h-full p-5 transition-colors group-hover:border-ink-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-ink-3">{CONTRACT_STATUS[c.status]}</div>
                    <h2 className="mt-1 text-lg font-semibold leading-snug">{c.title}</h2>
                    <div className="mt-1 text-sm text-ink-2">
                      {c.client.name} <span className="text-ink-3">hires</span> {c.freelancer.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-lg font-semibold">{c.totalUsd ? usd(c.totalUsd) : `≤ ${usd(c.clientLimits.budgetUsd)}`}</div>
                    {c.milestones.length > 0 && (
                      <div className="text-xs text-ink-3">
                        {done}/{c.milestones.length} milestones paid
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-ink-2">{c.summary ?? c.brief}</p>
                <div className="mt-4">
                  <MoneyBar milestones={c.milestones} total={total} />
                </div>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-ink group-hover:gap-2 transition-all">
                  {c.status === "negotiating" ? "Let the agents negotiate" : "Open contract"} <ArrowRight size={14} />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
