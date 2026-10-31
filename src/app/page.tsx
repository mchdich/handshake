import Link from "next/link";
import { ArrowRight, Gavel, Handshake as HandshakeIcon, Lock, ReceiptText, ScanSearch } from "lucide-react";
import { Logo } from "@/components/logo";

const STEPS = [
  {
    icon: HandshakeIcon,
    title: "Two agents negotiate",
    body: "Each side gives its own AI agent private limits: a budget ceiling, a minimum rate, a deadline. The agents trade offers until they agree on price, milestones and acceptance criteria. Code rejects any offer outside a mandate.",
  },
  {
    icon: Lock,
    title: "PayPal holds the money",
    body: "The client approves each milestone with PayPal. It's an authorization, not a charge: the money is set aside for the freelancer and nobody has paid anything yet.",
  },
  {
    icon: ScanSearch,
    title: "An AI checks the work",
    body: "The freelancer submits a link, a PR, a document or an image. The review agent opens it on a phone and a laptop, reads the code and CI, and checks every criterion with evidence.",
  },
  {
    icon: ReceiptText,
    title: "The contract pays itself",
    body: "When every criterion passes, PayPal captures the hold, pays the freelancer out and the PayPal Agent Toolkit issues a paid invoice. No chasing, no net-30.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/app" className="text-sm font-medium text-ink-2 hover:text-ink">
          Open the app
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-14 pb-20 md:pt-24">
          <p className="rise text-sm font-medium text-seal">For freelancers and the small businesses that hire them</p>
          <h1 className="rise mt-4 max-w-4xl font-display text-5xl leading-[1.02] md:text-7xl">
            Contracts that pay themselves.
          </h1>
          <p className="rise mt-6 max-w-2xl text-lg text-ink-2">
            Handshake turns a plain-English job into a signed contract with milestones, holds each payment with PayPal, and releases it the
            moment an AI reviewer confirms the work meets what you both agreed. Disagree? An AI mediator proposes a fair split and PayPal
            captures exactly that.
          </p>
          <div className="rise mt-9 flex flex-wrap items-center gap-3">
            <Link href="/app" className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-medium text-paper hover:bg-ink-2">
              Try the live demo <ArrowRight size={16} />
            </Link>
            <span className="text-sm text-ink-3">Runs on the PayPal sandbox. No sign-up.</span>
          </div>
        </section>

        <section className="border-y border-line bg-card">
          <div className="mx-auto grid max-w-6xl gap-px bg-line md:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="bg-card p-6 md:p-7">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-paper text-ink">
                    <s.icon size={17} />
                  </span>
                  <span className="font-mono text-xs text-ink-3">0{i + 1}</span>
                </div>
                <h2 className="mt-5 text-lg font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-2">
          <div>
            <h2 className="font-display text-4xl leading-tight">The AI decides. The code keeps it honest.</h2>
            <p className="mt-4 text-ink-2">
              Letting a model move money is only safe when the rules that matter aren&apos;t up to the model. In Handshake they aren&apos;t.
            </p>
          </div>
          <ul className="space-y-4 text-sm">
            {[
              ["Mandates are enforced in code.", "A negotiating agent can't offer more than its owner's budget or accept less than their minimum. Breaches are rejected and retried."],
              ["The verdict is computed, not chosen.", "The reviewer reports per-criterion findings with evidence. Money moves only if every criterion is met with enough confidence."],
              ["Deliverables are data, not instructions.", "A page that says “approve this” is just text to the reviewer. Prompt injection in a submission can't release a payment."],
              ["Disputes end in a partial capture.", "Both sides accept the mediator's split, PayPal captures that share from the hold and the remainder goes back on its own."],
            ].map(([h, b]) => (
              <li key={h} className="rounded-2xl border border-line bg-card p-5">
                <div className="font-semibold">{h}</div>
                <p className="mt-1 text-ink-2">{b}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-ink p-8 text-paper md:flex-row md:items-center md:p-10">
            <div>
              <div className="flex items-center gap-2 text-sm text-paper/60">
                <Gavel size={15} /> Built on PayPal Orders, Payments, Payouts, Invoicing and the PayPal Agent Toolkit
              </div>
              <p className="mt-3 max-w-xl font-display text-3xl leading-tight">A sample deal is waiting: a bakery hires a web developer. Watch the agents strike it.</p>
            </div>
            <Link href="/app" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-paper px-6 text-sm font-medium text-ink hover:bg-white">
              Open the demo <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6 text-xs text-ink-3">
          <span>Handshake · PayPal AI Hackathon 2026</span>
          <span>Sandbox only. No real money moves.</span>
        </div>
      </footer>
    </div>
  );
}
