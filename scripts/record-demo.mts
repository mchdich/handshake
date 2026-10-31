// Records the demo walkthrough of a local Handshake server into a video with a visible cursor.
// Usage: npx tsx scripts/record-demo.mts <baseUrl> <outDir>
// Writes <outDir>/raw.webm and <outDir>/marks.json (seconds since start for each step).
import { chromium, type Locator, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? "demo";
fs.mkdirSync(out, { recursive: true });

const W = 1600;
const H = 900;
const t0 = Date.now();
const marks: { at: number; label: string }[] = [];
const mark = (label: string) => {
  marks.push({ at: (Date.now() - t0) / 1000, label });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
  fs.writeFileSync(path.join(out, "marks.json"), JSON.stringify(marks, null, 1));
};

const CURSOR = `
  if (!document.getElementById('demo-cursor')) {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.5-3.5 7z" fill="#1b1813" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: (window.__cx ?? ${W / 2}) + 'px', top: (window.__cy ?? ${H / 2}) + 'px', zIndex: 2147483647, pointerEvents: 'none', transition: 'left .55s cubic-bezier(.4,0,.2,1), top .55s cubic-bezier(.4,0,.2,1), transform .12s', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.25))' });
    document.documentElement.appendChild(c);
  }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureCursor(page: Page) {
  await page.evaluate(CURSOR).catch(() => {});
}

async function moveTo(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  await sleep(250);
  const box = await loc.boundingBox();
  if (!box) return;
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await ensureCursor(page);
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("demo-cursor")!;
      c.style.left = x + "px";
      c.style.top = y + "px";
      (window as unknown as { __cx: number; __cy: number }).__cx = x;
      (window as unknown as { __cx: number; __cy: number }).__cy = y;
    },
    [x, y],
  );
  await sleep(650);
}

async function click(page: Page, loc: Locator) {
  await moveTo(page, loc);
  await page.evaluate(() => {
    const c = document.getElementById("demo-cursor");
    if (c) c.style.transform = "scale(.8)";
    setTimeout(() => c && (c.style.transform = ""), 140);
  });
  await loc.click();
  await sleep(500);
}

async function type(page: Page, loc: Locator, text: string) {
  await click(page, loc);
  await loc.fill("");
  await loc.pressSequentially(text, { delay: 28 });
}

/** Smoothly scroll so the element sits near the top third of the viewport. */
async function glide(page: Page, loc: Locator, offset = 120) {
  const box = await loc.boundingBox();
  if (!box) return;
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), box.y - offset);
  await sleep(1100);
}

async function waitFor(page: Page, fn: () => Promise<boolean>, timeoutMs = 600_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(1000);
  }
  throw new Error("timed out");
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: out, size: { width: W, height: H } },
});
const page = await ctx.newPage();
page.on("load", () => ensureCursor(page));

try {
  // 1. Landing
  mark("landing");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await ensureCursor(page);
  await sleep(2500);
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: "smooth" }));
  await sleep(2500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1000);
  await click(page, page.getByRole("link", { name: /Try the live demo/ }));

  // 2. New deal
  await page.waitForURL(/\/app$/, { timeout: 120_000 });
  await sleep(1500);
  mark("new-deal");
  await click(page, page.getByRole("link", { name: "New deal" }).or(page.getByRole("button", { name: "New deal" })).first());
  await page.waitForURL(/\/app\/new/, { timeout: 120_000 });
  await sleep(1500);
  await glide(page, page.getByText("Client agent's mandate"), 200);
  await sleep(1500);
  await glide(page, page.getByRole("button", { name: /Create deal/ }), 500);
  await click(page, page.getByRole("button", { name: /Create deal/ }));

  // 3. Negotiation streams in
  await page.waitForURL(/\/app\/c\//, { timeout: 120_000 });
  mark("negotiation");
  await waitFor(page, async () => (await page.getByRole("button", { name: /^Sign as/ }).count()) > 0, 900_000);
  mark("drafted");
  await sleep(1500);
  const transcript = page.locator(".max-h-\\[520px\\]");
  await transcript.evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1500);
  await transcript.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  await sleep(2500);

  // 4. Sign both sides
  mark("sign");
  await click(page, page.getByRole("button", { name: /^Sign as/ }));
  await sleep(800);
  await click(page, page.getByRole("tab", { name: /freelancer/ }));
  await click(page, page.getByRole("button", { name: /^Sign as/ }));
  await sleep(1500);
  await click(page, page.getByRole("tab", { name: /client/ }));

  // 5. Fund milestone 2 (the live page)
  mark("fund");
  const cards = page.locator("h3");
  const m2Title = await cards.nth(1).innerText();
  const m2 = page.locator("div.rise", { has: page.getByRole("heading", { name: m2Title }) });
  await glide(page, m2, 110);
  await sleep(1500);
  await click(page, m2.getByRole("button", { name: /sandbox test card/ }));
  await waitFor(page, async () => (await m2.getByText("Held by PayPal").count()) > 0, 120_000);
  mark("held");
  await sleep(2500);

  // 6. Freelancer delivers v1 — fails
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await click(page, page.getByRole("tab", { name: /freelancer/ }));
  await glide(page, m2, 110);
  mark("deliver-v1");
  const url = m2.getByRole("textbox", { name: /https/ });
  await type(page, url, `${base}/demo/crumb-v1`);
  await click(page, m2.getByRole("button", { name: "Submit for review" }));
  await waitFor(page, async () => (await m2.getByText("Changes requested").count()) > 0, 900_000);
  mark("v1-failed");
  await sleep(1000);
  await glide(page, m2.getByText("Acceptance criteria", { exact: false }).first(), 140);
  await sleep(3500);
  await glide(page, m2.getByText("What the review agent saw"), 160);
  await sleep(1200);
  const phone = m2.locator("figure").first().locator("div").first();
  await phone.evaluate((el) => el.scrollTo({ top: 220, behavior: "smooth" }));
  await sleep(3500);
  await glide(page, m2.getByText(/^Not yet/), 200);
  await sleep(4000);

  // 7. Deliver v2 — passes, PayPal captures and pays out
  mark("deliver-v2");
  const url2 = m2.getByRole("textbox", { name: /https/ });
  await type(page, url2, `${base}/demo/crumb-v2`);
  await type(page, m2.getByRole("textbox", { name: /Note for the reviewer/ }), "Fixed the prices, the Location link and the phone layout. The pre-order form posts to the bakery order endpoint (/api/demo/preorder), which emails each order to orders@crumbandco.example.");
  await click(page, m2.getByRole("button", { name: "Submit for review" }));
  await waitFor(page, async () => (await m2.getByText("Verified and paid").count()) > 0, 300_000);
  mark("v2-paid");
  await sleep(1000);
  await glide(page, m2, 110);
  await sleep(3000);
  await glide(page, m2.getByText("Verified and paid"), 260);
  await sleep(4500);

  // 8. Dispute on milestone 1
  mark("dispute");
  const m1Title = await cards.nth(0).innerText();
  const m1 = page.locator("div.rise", { has: page.getByRole("heading", { name: m1Title }) });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await click(page, page.getByRole("tab", { name: /client/ }));
  await glide(page, m1, 110);
  await click(page, m1.getByRole("button", { name: /sandbox test card/ }));
  await waitFor(page, async () => (await m1.getByText("Held by PayPal").count()) > 0, 120_000);
  await click(page, page.getByRole("tab", { name: /freelancer/ }));
  await glide(page, m1, 110);
  await type(page, m1.getByRole("textbox", { name: /https/ }), `${base}/demo/crumb-v1`);
  await click(page, m1.getByRole("button", { name: "Submit for review" }));
  await waitFor(page, async () => (await m1.getByText("Changes requested").count()) > 0, 900_000);
  mark("m1-failed");
  await glide(page, m1.getByRole("button", { name: /Disagree/ }), 400);
  await click(page, m1.getByRole("button", { name: /Disagree/ }));
  await type(
    page,
    m1.getByRole("textbox", { name: /Why do you disagree/ }),
    "It's a mockup. Layout, hours, location and the order form are all there; two prices and one link are small fixes.",
  );
  await click(page, m1.getByRole("button", { name: "Open mediation" }));
  await waitFor(page, async () => (await m1.getByRole("button", { name: "Accept split" }).count()) > 0, 900_000);
  mark("ruling");
  await glide(page, m1.getByText("Mediator's proposal"), 160);
  await sleep(5000);
  await click(page, m1.getByRole("button", { name: "Accept split" }));
  await sleep(1200);
  await click(page, page.getByRole("tab", { name: /client/ }));
  await glide(page, m1.getByText("Mediator's proposal"), 160);
  await click(page, m1.getByRole("button", { name: "Accept split" }));
  await waitFor(page, async () => (await m1.getByText("Settled by agreement").count()) > 0, 180_000);
  mark("settled");
  await glide(page, m1.getByText("Settled by agreement"), 260);
  await sleep(4500);

  // 9. Ledger
  mark("ledger");
  await click(page, page.getByRole("link", { name: "Ledger" }));
  await page.waitForURL(/ledger/, { timeout: 120_000 });
  await sleep(4000);
  await click(page, page.getByRole("tab", { name: "milestones" }));
  await sleep(3500);

  // 10. Assistant
  mark("assistant");
  await click(page, page.getByRole("link", { name: "Assistant" }));
  await page.waitForURL(/assistant/, { timeout: 120_000 });
  await sleep(1200);
  await type(page, page.getByPlaceholder("Ask about your money…"), "What did I pay in PayPal fees, and are all my invoices paid?");
  await click(page, page.getByRole("button", { name: "Send" }));
  await waitFor(page, async () => (await page.locator(".md").count()) > 0, 600_000);
  mark("answer");
  await sleep(1500);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await sleep(6000);
  mark("end");
} catch (e) {
  mark(`error: ${(e as Error).message}`);
  await page.screenshot({ path: path.join(out, "error.png") });
} finally {
  const video = page.video();
  await ctx.close();
  await browser.close();
  if (video) fs.renameSync(await video.path(), path.join(out, "raw.webm"));
}
