// One AI layer, two backends:
//  - "anthropic": the Claude API (production; needs ANTHROPIC_API_KEY)
//  - "claude-cli": the local `claude -p` CLI (development on a machine logged into Claude Code)
// Every agent in Handshake goes through structured() or runAgent().

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";

export const MODEL = process.env.HANDSHAKE_MODEL ?? "claude-opus-5-5";

export function backend(): "anthropic" | "claude-cli" {
  if (process.env.HANDSHAKE_LLM === "claude-cli") return "claude-cli";
  if (process.env.ANTHROPIC_API_KEY || process.env.HANDSHAKE_LLM === "anthropic") return "anthropic";
  return "claude-cli";
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export type ImageInput = { mediaType: string; data: string };
type Effort = "low" | "medium" | "high" | "xhigh";

/** JSON Schema accepted by structured outputs: closed objects, every key required, no numeric/length bounds. */
export function toStrictSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  const drop = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!drop.has(k)) out[k] = walk(v);
    if (out.type === "object" && out.properties) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return walk(raw) as Record<string, unknown>;
}

export async function structured<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  images?: ImageInput[];
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const jsonSchema = toStrictSchema(opts.schema);
  let raw: unknown;
  let model = MODEL;
  if (backend() === "anthropic") {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(opts.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data },
        }),
      ),
      { type: "text", text: opts.prompt },
    ];
    const res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: {
        effort: opts.effort ?? "medium",
        format: { type: "json_schema", schema: jsonSchema },
      },
      messages: [{ role: "user", content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    raw = JSON.parse(text);
    model = res.model;
  } else {
    raw = await cliStructured(opts.system, opts.prompt, jsonSchema, opts.images ?? []);
    model = "claude (local CLI)";
  }
  return { data: opts.schema.parse(raw), model };
}

// ---------- local CLI backend ----------

function runCli(args: string[], stdin: string, timeoutMs = 240_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out || err);
    });
    child.stdin.end(stdin);
  });
}

async function cliStructured(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  images: ImageInput[],
): Promise<unknown> {
  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--model", process.env.HANDSHAKE_CLI_MODEL ?? "sonnet",
    "--system-prompt", system,
    "--json-schema", JSON.stringify(schema),
  ];
  let fullPrompt = prompt;
  if (images.length) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handshake-img-"));
    const files = images.map((img, i) => {
      const f = path.join(dir, `image-${i}.${img.mediaType.split("/")[1] ?? "png"}`);
      fs.writeFileSync(f, Buffer.from(img.data, "base64"));
      return f;
    });
    args.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", dir);
    fullPrompt = `Attached images (open each with the Read tool before answering):\n${files.join("\n")}\n\n${prompt}`;
  } else {
    args.push("--tools", "");
  }
  const out = await runCli(args, fullPrompt);
  let parsed: { is_error?: boolean; structured_output?: unknown; result?: string };
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`claude CLI returned non-JSON: ${out.slice(0, 300)}`);
  }
  if (parsed.is_error || parsed.structured_output === undefined) {
    throw new Error(`claude CLI error: ${String(parsed.result).slice(0, 300)}`);
  }
  return parsed.structured_output;
}

// ---------- tool-using agent ----------

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

export type AgentStep =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | { kind: "tool_result"; name: string; ok: boolean; output: string };

export async function runAgent(opts: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  tools: AgentTool[];
  onStep?: (s: AgentStep) => void;
  maxSteps?: number;
}): Promise<{ text: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  const emit = (s: AgentStep) => {
    steps.push(s);
    opts.onStep?.(s);
  };
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const exec = async (name: string, input: Record<string, unknown>) => {
    emit({ kind: "tool_call", name, input });
    const tool = byName.get(name);
    try {
      if (!tool) throw new Error(`Unknown tool ${name}`);
      const out = await tool.run(input);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      emit({ kind: "tool_result", name, ok: true, output: text.slice(0, 4000) });
      return { text: text.slice(0, 12000), ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emit({ kind: "tool_result", name, ok: false, output: msg });
      return { text: msg, ok: false };
    }
  };

  if (backend() === "anthropic") {
    const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = opts.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    for (let i = 0; i < (opts.maxSteps ?? 12); i++) {
      const res = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: opts.system,
        output_config: { effort: "medium" },
        tools,
        messages,
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
      messages.push({ role: "assistant", content: res.content });
      for (const b of res.content) if (b.type === "text" && b.text.trim()) emit({ kind: "text", text: b.text });
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || calls.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return { text, steps };
      }
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const r = await exec(c.name, c.input as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: c.id, content: r.text, is_error: !r.ok };
        }),
      );
      messages.push({ role: "user", content: results });
    }
    return { text: "I stopped after too many steps. Try a narrower request.", steps };
  }

  // CLI backend: emulate tool use with one structured "next action" per step.
  const Step = z.object({
    say: z.string().describe("What you tell the user now (may be empty while working)."),
    tool: z.string().describe("Tool to call next, or empty string when finished."),
    tool_input_json: z.string().describe("JSON object string with the tool input, or {} when finished."),
  });
  const catalog = opts.tools
    .map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");
  const transcript: string[] = opts.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  for (let i = 0; i < (opts.maxSteps ?? 12); i++) {
    const { data } = await structured({
      system: `${opts.system}\n\nThese tools are run for you by the host application, one per step:\n${catalog}\n\nYou have no native tool-calling here: never try to invoke a tool directly. To use one, return its name in "tool" and its input in "tool_input_json"; the host runs it and the next step shows you the TOOL RESULT. Look things up before answering. When you have the final answer, put it in "say" and leave "tool" empty.`,
      prompt: transcript.join("\n\n"),
      schema: Step,
    });
    if (data.say.trim()) emit({ kind: "text", text: data.say });
    if (!data.tool) return { text: data.say, steps };
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(data.tool_input_json || "{}");
    } catch {
      /* leave empty */
    }
    const r = await exec(data.tool, input);
    transcript.push(`ASSISTANT called ${data.tool}(${JSON.stringify(input)})`);
    transcript.push(`TOOL RESULT (${r.ok ? "ok" : "error"}): ${r.text}`);
  }
  return { text: "I stopped after too many steps. Try a narrower request.", steps };
}
