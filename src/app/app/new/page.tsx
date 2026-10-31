"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Card, Field, inputCls } from "@/components/ui";

const SAMPLE = {
  client: { name: "Maya Reyes", email: "maya@crumbandco.example", business: "Crumb & Co. Bakery" },
  freelancer: { name: "Leo Okafor", paypalEmail: "", skills: "web developer, Next.js, 6 years" },
  brief:
    "Our neighborhood bakery needs a one-page website: our menu with prices, opening hours, where to find us, and a form so customers can pre-order custom cakes, with orders landing in orders@crumbandco.example. Most of our customers are on their phones.",
  clientLimits: { budgetUsd: 1200, deadlineDays: 21, mustHaves: "Works well on phones; menu shows prices; cake pre-order form" },
  freelancerLimits: { minUsd: 900, minDays: 10, notes: "Prefers 3 milestones and a small first one. Won't do logo design." },
};

export default function NewDeal() {
  const router = useRouter();
  const [d, setD] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof typeof SAMPLE>(k: K, v: Partial<(typeof SAMPLE)[K]> | string) =>
    setD((p) => ({ ...p, [k]: typeof v === "string" ? v : { ...(p[k] as object), ...v } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...d,
        freelancer: { ...d.freelancer, paypalEmail: d.freelancer.paypalEmail || "leo.okafor@personal.example.com" },
      };
      const c = await api<{ id: string }>("/api/contracts", payload);
      router.push(`/app/c/${c.id}?negotiate=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">New deal</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Each side gives its own AI agent a mandate. The agents negotiate price, timeline and milestones, and can&apos;t
          agree to anything outside the limits you set here. Limits stay private to your own agent.
        </p>
      </div>

      <Card className="p-5">
        <Field label="What needs doing?" hint="Plain English. The agents and the contract drafter work from this.">
          <textarea className={`${inputCls} min-h-24`} value={d.brief} onChange={(e) => set("brief", e.target.value)} required minLength={20} />
        </Field>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Client</h2>
            <span className="text-xs text-ink-3">pays through PayPal</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputCls} value={d.client.name} onChange={(e) => set("client", { name: e.target.value })} required />
            </Field>
            <Field label="Business">
              <input className={inputCls} value={d.client.business} onChange={(e) => set("client", { business: e.target.value })} required />
            </Field>
          </div>
          <Field label="Email" hint="Receives the PayPal invoice for each paid milestone.">
            <input type="email" className={inputCls} value={d.client.email} onChange={(e) => set("client", { email: e.target.value })} required />
          </Field>
          <div className="rounded-xl border border-dashed border-line-2 p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <Lock size={12} /> Client agent&apos;s mandate
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Budget ceiling (USD)">
                <input type="number" min={1} className={inputCls} value={d.clientLimits.budgetUsd} onChange={(e) => set("clientLimits", { budgetUsd: Number(e.target.value) })} required />
              </Field>
              <Field label="Done within (days)">
                <input type="number" min={1} className={inputCls} value={d.clientLimits.deadlineDays} onChange={(e) => set("clientLimits", { deadlineDays: Number(e.target.value) })} required />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Must-haves">
                <input className={inputCls} value={d.clientLimits.mustHaves} onChange={(e) => set("clientLimits", { mustHaves: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Freelancer</h2>
            <span className="text-xs text-ink-3">gets paid out with PayPal</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputCls} value={d.freelancer.name} onChange={(e) => set("freelancer", { name: e.target.value })} required />
            </Field>
            <Field label="Skills">
              <input className={inputCls} value={d.freelancer.skills} onChange={(e) => set("freelancer", { skills: e.target.value })} />
            </Field>
          </div>
          <Field label="PayPal email for payouts" hint="Leave empty to use the demo sandbox account.">
            <input type="email" className={inputCls} placeholder="leo.okafor@personal.example.com" value={d.freelancer.paypalEmail} onChange={(e) => set("freelancer", { paypalEmail: e.target.value })} />
          </Field>
          <div className="rounded-xl border border-dashed border-line-2 p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <Lock size={12} /> Freelancer agent&apos;s mandate
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Won't go below (USD)">
                <input type="number" min={1} className={inputCls} value={d.freelancerLimits.minUsd} onChange={(e) => set("freelancerLimits", { minUsd: Number(e.target.value) })} required />
              </Field>
              <Field label="Needs at least (days)">
                <input type="number" min={1} className={inputCls} value={d.freelancerLimits.minDays} onChange={(e) => set("freelancerLimits", { minDays: Number(e.target.value) })} required />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes for the agent">
                <input className={inputCls} value={d.freelancerLimits.notes} onChange={(e) => set("freelancerLimits", { notes: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end">
        <Button busy={busy} type="submit">
          Create deal and start negotiating
        </Button>
      </div>
    </form>
  );
}
