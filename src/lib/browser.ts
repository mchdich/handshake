// Opens a delivered website in a real headless browser, at phone and desktop sizes,
// and reports what a careful human reviewer would check: screenshots, overflow,
// navigation, forms, tap targets, console errors.

import { chromium, type Browser, type Page } from "playwright-core";

export type PageCheck = {
  viewport: string;
  status: number | null;
  finalUrl: string;
  loadMs: number;
  title: string;
  horizontalOverflowPx: number;
  headings: string[];
  anchors: { text: string; href: string; targetExists: boolean }[];
  forms: { action: string; method: string; fields: { label: string; type: string; required: boolean }[]; submitText: string }[];
  smallTapTargets: string[];
  imagesMissingAlt: number;
  consoleErrors: string[];
  screenshot: string; // base64 jpeg
};

let browser: Promise<Browser> | null = null;
function getBrowser() {
  browser ??= chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }).catch((e) => {
    browser = null;
    throw e;
  });
  return browser;
}

// Plain JS string so bundlers can't inject helpers (e.g. __name) into code that runs in the page.
const INSPECT_JS = `(() => {
    const doc = document.documentElement;
    const text = (el) => (el.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 80);
    const labelFor = (el) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(\`label[for="\${CSS.escape(id)}"]\`) : null;
      return (
        (byFor && text(byFor)) ||
        (el.closest("label") && text(el.closest("label"))) ||
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        "(unlabeled)"
      );
    };
    const interactive = [...document.querySelectorAll("a, button, input, select, textarea")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    return {
      title: document.title,
      horizontalOverflowPx: Math.max(0, doc.scrollWidth - window.innerWidth),
      headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => \`\${h.tagName}: \${text(h)}\`).slice(0, 30),
      anchors: [...document.querySelectorAll("a[href^='#']")]
        .map((a) => {
          const href = a.getAttribute("href") ?? "";
          return { text: text(a), href, targetExists: href.length > 1 && !!document.getElementById(href.slice(1)) };
        })
        .slice(0, 30),
      forms: [...document.querySelectorAll("form")].slice(0, 5).map((f) => ({
        action: f.getAttribute("action") ? f.action : "(none)",
        method: (f.getAttribute("method") ?? "get").toUpperCase(),
        fields: [...f.querySelectorAll("input, select, textarea")]
          .filter((el) => el.type !== "hidden")
          .map((el) => ({
            label: labelFor(el),
            type: el.type || el.tagName.toLowerCase(),
            required: el.required,
          })),
        submitText: text(f.querySelector("button, input[type=submit]") ?? f) || "(none)",
      })),
      smallTapTargets: interactive
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height < 44 && r.width < 44;
        })
        .map((el) => \`\${el.tagName.toLowerCase()} "\${text(el) || el.getAttribute("aria-label") || ""}" \${Math.round(el.getBoundingClientRect().width)}x\${Math.round(el.getBoundingClientRect().height)}\`)
        .slice(0, 15),
      imagesMissingAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    };
  })()`;

type PageInfo = Omit<PageCheck, "viewport" | "status" | "finalUrl" | "loadMs" | "consoleErrors" | "screenshot">;

async function inspect(page: Page): Promise<PageInfo> {
  return page.evaluate(INSPECT_JS) as Promise<PageInfo>;
}

async function checkAt(url: string, width: number, height: number, mobile: boolean): Promise<PageCheck> {
  const ctx = await (await getBrowser()).newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 HandshakeReviewer"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 HandshakeReviewer",
  });
  // Redirects and subresources go through the same SSRF guard as the first URL.
  await ctx.route("**/*", (route) => {
    let host = "";
    try {
      host = new URL(route.request().url()).hostname;
    } catch {}
    return isPrivateHost(host) && /^https?:/.test(route.request().url()) ? route.abort("blockedbyclient") : route.continue();
  });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => consoleErrors.push(e.message.slice(0, 200)));
  try {
    const t0 = Date.now();
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 }).catch(async () =>
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }),
    );
    const loadMs = Date.now() - t0;
    const info = await inspect(page);
    // Phone emulation zooms out to fit wide content, which hides overflow from innerWidth; compare to the real viewport.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    info.horizontalOverflowPx = Math.max(info.horizontalOverflowPx, scrollWidth - width);
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const shot = await page.screenshot({
      type: "jpeg",
      quality: 60,
      fullPage: fullHeight <= 3200,
      clip: fullHeight > 3200 ? { x: 0, y: 0, width, height: 3200 } : undefined,
    });
    return {
      viewport: `${width}x${height}${mobile ? " (phone)" : ""}`,
      status: res?.status() ?? null,
      finalUrl: page.url(),
      loadMs,
      ...info,
      consoleErrors: consoleErrors.slice(0, 10),
      screenshot: shot.toString("base64"),
    };
  } finally {
    await ctx.close();
  }
}

/** Hosts the reviewer must never reach: loopback, private ranges, link-local, cloud metadata. */
export function isPrivateHost(hostname: string) {
  // Local development only: lets the reviewer open the demo deliverables served by this app.
  if (process.env.HANDSHAKE_ALLOW_LOCAL === "1") return false;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) ||
    h === "::1" ||
    h === "0.0.0.0" ||
    /^(fc|fd|fe80|::ffff:)/.test(h)
  );
}

export async function checkSite(url: string): Promise<PageCheck[]> {
  return Promise.all([checkAt(url, 390, 844, true), checkAt(url, 1280, 800, false)]);
}

export function describeCheck(p: PageCheck) {
  const lines = [
    `Viewport ${p.viewport}: HTTP ${p.status ?? "?"} in ${p.loadMs} ms → ${p.finalUrl}`,
    `Title: ${p.title || "(none)"}`,
    `Horizontal overflow: ${p.horizontalOverflowPx ? `${p.horizontalOverflowPx}px (page scrolls sideways)` : "none"}`,
    `Headings:\n  ${p.headings.join("\n  ") || "(none)"}`,
    `In-page links:\n  ${p.anchors.map((a) => `"${a.text}" → ${a.href}${a.targetExists ? "" : " (TARGET MISSING)"}`).join("\n  ") || "(none)"}`,
    `Forms:\n  ${
      p.forms
        .map((f, i) => `form ${i + 1} [${f.method} ${f.action}; submit: ${f.submitText}]: ${f.fields.map((x) => `${x.label} (${x.type}${x.required ? ", required" : ""})`).join("; ")}`)
        .join("\n  ") || "(none)"
    }`,
    `Tap targets smaller than 44px: ${p.smallTapTargets.length ? p.smallTapTargets.join("; ") : "none"}`,
    `Images without alt text: ${p.imagesMissingAlt}`,
    `Console errors: ${p.consoleErrors.length ? p.consoleErrors.join(" | ") : "none"}`,
  ];
  return lines.join("\n");
}
