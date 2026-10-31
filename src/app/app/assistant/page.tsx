"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stream } from "@/lib/client";
import type { AgentStep } from "@/lib/llm";
import { Card, cx, inputCls, Spinner } from "@/components/ui";

type Msg = { role: "user" | "assistant"; content: string; steps?: AgentStep[] };

const SUGGESTIONS = [
  "How much is PayPal holding for me right now, and for which milestones?",
  "List the invoices Handshake issued and their status.",
  "What did I pay in PayPal fees so far?",
  "Did any milestone fail review? Why?",
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const history = [...msgs, { role: "user" as const, content: q.trim() }];
    setMsgs([...history, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])]);
    try {
      await stream("/api/ops", { history: history.slice(-20).map(({ role, content }) => ({ role, content })) }, (e) => {
        if (e.type === "step") patch((m) => ({ ...m, steps: [...(m.steps ?? []), e.step as AgentStep] }));
        if (e.type === "done") patch((m) => ({ ...m, content: e.text as string }));
        if (e.type === "error") patch((m) => ({ ...m, content: `Something went wrong: ${e.message}` }));
      });
    } catch (err) {
      patch((m) => ({ ...m, content: `Something went wrong: ${(err as Error).message}` }));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl">Money assistant</h1>
        <p className="mt-1 text-sm text-ink-2">
          Ask about holds, payouts, fees and invoices. It reads your Handshake ledger and looks things up in PayPal with the PayPal Agent Toolkit.
        </p>
      </div>

      {msgs.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-xl border border-line bg-card px-4 py-3 text-left text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-sm text-paper">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.steps?.filter((s) => s.kind === "tool_call").map((s, j) => {
                const call = s as Extract<AgentStep, { kind: "tool_call" }>;
                const result = m.steps?.filter((x) => x.kind === "tool_result")[j] as Extract<AgentStep, { kind: "tool_result" }> | undefined;
                return (
                  <details key={j} className="group rounded-xl border border-line bg-card text-xs">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-ink-2">
                      {result ? <Wrench size={12} className={result.ok ? "text-paid" : "text-bad"} /> : <Spinner className="h-3 w-3" />}
                      <span className="font-mono">{call.name}</span>
                      <span className="truncate text-ink-3">{JSON.stringify(call.input)}</span>
                    </summary>
                    {result && <pre className="max-h-60 overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2">{result.output.slice(0, 4000)}</pre>}
                  </details>
                );
              })}
              {m.content ? (
                <Card className="md px-4 py-3 text-sm leading-relaxed">
                  <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                </Card>
              ) : (
                busy && i === msgs.length - 1 && (
                  <div className="flex items-center gap-2 text-sm text-ink-3">
                    <Spinner /> Thinking
                  </div>
                )
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-4 flex gap-2 rounded-full border border-line bg-card p-1.5 shadow-sm"
      >
        <input className={cx(inputCls, "border-0 bg-transparent shadow-none focus:ring-0")} placeholder="Ask about your money…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button aria-label="Send" disabled={busy || !input.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-paper disabled:opacity-40">
          <ArrowUp size={16} />
        </button>
      </form>
    </div>
  );
}
