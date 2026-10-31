// Turns a deliverable (link, text, image) into evidence the reviewer can read.
// GitHub pull requests and repos go through the GitHub API so the reviewer sees
// the real diff and CI results, not a marketing page.

import type { Submission } from "./db";
import { checkSite, describeCheck, isPrivateHost } from "./browser";

export type Evidence = { label: string; body: string; image?: { mediaType: string; data: string } }[];

const MAX = 14_000;

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "handshake-reviewer",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function githubPull(owner: string, repo: string, n: string): Promise<Evidence> {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const pr = await getJson(`${api}/pulls/${n}`);
  const files = (await getJson(`${api}/pulls/${n}/files?per_page=100`)) as {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
  let checks = "No CI checks found.";
  try {
    const runs = await getJson(`${api}/commits/${pr.head.sha}/check-runs?per_page=50`);
    if (runs.check_runs?.length) {
      checks = runs.check_runs
        .map((r: { name: string; status: string; conclusion: string | null }) => `${r.name}: ${r.conclusion ?? r.status}`)
        .join("\n");
    }
  } catch {
    /* checks are optional */
  }
  let budget = MAX;
  const patches = files
    .map((f) => {
      const head = `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`;
      const body = (f.patch ?? "").slice(0, Math.max(0, budget));
      budget -= body.length;
      return `${head}\n${body}`;
    })
    .join("\n\n");
  return [
    {
      label: "GitHub pull request",
      body: `#${pr.number} ${pr.title}\nState: ${pr.state}${pr.merged ? " (merged)" : ""}\nAuthor: ${pr.user?.login}\n\n${pr.body ?? "(no description)"}`,
    },
    { label: "CI checks on the PR head commit", body: checks },
    { label: `Changed files (${files.length})`, body: patches },
  ];
}

async function githubRepo(owner: string, repo: string): Promise<Evidence> {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const meta = await getJson(api);
  const tree = await getJson(`${api}/git/trees/${meta.default_branch}?recursive=1`);
  const paths = (tree.tree as { path: string; type: string }[])
    .filter((t) => t.type === "blob")
    .map((t) => t.path)
    .slice(0, 400)
    .join("\n");
  let readme = "(no README)";
  try {
    const r = await getJson(`${api}/readme`);
    readme = Buffer.from(r.content, "base64").toString("utf8").slice(0, 8000);
  } catch {
    /* optional */
  }
  return [
    { label: "GitHub repository", body: `${meta.full_name}: ${meta.description ?? ""}\nDefault branch: ${meta.default_branch}\nLast push: ${meta.pushed_at}` },
    { label: "README", body: readme },
    { label: "Files", body: paths },
  ];
}

function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const metas = [...html.matchAll(/<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi)]
    .map((m) => `${m[1]}: ${m[2]}`)
    .slice(0, 20)
    .join("\n");
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => `${m[2].replace(/<[^>]+>/g, "").trim()} → ${m[1]}`)
    .filter((l) => l.length < 200)
    .slice(0, 60)
    .join("\n");
  const imgs = [...html.matchAll(/<img[^>]*>/gi)]
    .map((m) => {
      const alt = m[0].match(/alt=["']([^"']*)["']/i)?.[1];
      const src = m[0].match(/src=["']([^"']*)["']/i)?.[1];
      return `img src=${src ?? "?"} alt=${alt === undefined ? "(missing)" : JSON.stringify(alt)}`;
    })
    .slice(0, 40)
    .join("\n");
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n## ")
    .replace(/<(p|li|div|section|br|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title, metas, links, imgs, text };
}

/** Keep the reviewer off private networks (it runs on a public server). */
function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) links can be reviewed");
  if (isPrivateHost(u.hostname)) throw new Error("private network addresses can't be reviewed");
}

async function webPage(url: string): Promise<Evidence> {
  assertPublicUrl(url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Handshake reviewer)" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!type.includes("html")) {
    return [{ label: `File at ${url} (${type}, HTTP ${res.status})`, body: body.slice(0, MAX) }];
  }
  const p = htmlToText(body);
  return [
    { label: "Fetched page", body: `URL: ${res.url}\nHTTP ${res.status}\nTitle: ${p.title}\n${p.metas}` },
    { label: "Visible text", body: p.text.slice(0, MAX) },
    { label: "Links", body: p.links },
    { label: "Images", body: p.imgs || "(none)" },
  ];
}

async function browserEvidence(url: string): Promise<Evidence> {
  try {
    assertPublicUrl(url);
    const checks = await checkSite(url);
    return checks.map((c) => ({
      label: `Opened in a real browser at ${c.viewport}`,
      body: `${describeCheck(c)}\n(Screenshot of this view is attached as an image.)`,
      image: { mediaType: "image/jpeg", data: c.screenshot },
    }));
  } catch (e) {
    return [{ label: "Browser check", body: `Could not open the page in a browser: ${e instanceof Error ? e.message : e}` }];
  }
}

export async function gatherEvidence(s: Submission): Promise<Evidence> {
  const out: Evidence = [];
  if (s.note) out.push({ label: "Freelancer's note", body: s.note });
  if (s.text) out.push({ label: "Submitted text", body: s.text.slice(0, MAX) });
  if (s.url) {
    try {
      const gh = s.url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/pull\/(\d+))?/);
      if (gh?.[3]) out.push(...(await githubPull(gh[1], gh[2], gh[3])));
      else if (gh) out.push(...(await githubRepo(gh[1], gh[2].replace(/\.git$/, ""))));
      else {
        out.push(...(await webPage(s.url)));
        out.push(...(await browserEvidence(s.url)));
      }
    } catch (e) {
      out.push({
        label: "Link check",
        body: `Could not open ${s.url}: ${e instanceof Error ? e.message : e}`,
      });
    }
  }
  if (s.image) out.push({ label: "Attached image", body: `${s.image.name} (shown to you as an image)` });
  return out;
}

export const evidenceToPrompt = (e: Evidence) =>
  e.map((x) => `<evidence label="${x.label}">\n${x.body}\n</evidence>`).join("\n\n");

export const evidenceImages = (e: Evidence) => e.flatMap((x) => (x.image ? [x.image] : []));
