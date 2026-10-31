# Handshake

**Contracts that pay themselves.** Two AI agents negotiate a freelance deal inside their owners' private limits. PayPal holds each milestone's money. An AI reviewer opens the delivered work, checks every acceptance criterion with evidence, and the code releases the payment the moment it passes. If the two sides disagree, an AI mediator proposes a split and PayPal captures exactly that share.

Built for the PayPal AI Hackathon 2026. Runs entirely on the PayPal sandbox.

## How it works

1. **Negotiate.** The client's agent knows the budget ceiling and deadline. The freelancer's agent knows the minimum rate and lead time. They trade structured offers (price, milestones, due days) until one side accepts the other's exact offer. A drafter agent then writes a summary and testable acceptance criteria for each milestone.
2. **Hold.** Both sides sign. The client funds each milestone with a PayPal order using `intent=AUTHORIZE`. The money is reserved, not charged.
3. **Deliver and verify.** The freelancer submits a link, a GitHub PR or repo, a document or an image. The review agent gathers evidence: it opens the page in headless Chromium at phone and laptop sizes (screenshots, horizontal overflow, broken in-page links, form fields, tap targets, console errors), reads PR diffs and CI results, and then judges each criterion.
4. **Pay.** If every criterion passes, Handshake captures the authorization, pays the freelancer's net amount with PayPal Payouts, and uses the PayPal Agent Toolkit to issue an invoice and mark it paid. If not, the freelancer gets a specific list of fixes and the money stays held.
5. **Mediate.** Either side can dispute a failed review. The mediator rules per criterion (yes / partly / no) and proposes a share. When both accept, Handshake does a partial final capture and PayPal releases the rest of the hold to the client.

A **money assistant** answers questions about holds, fees, payouts, invoices and disputes. It uses Handshake's own ledger plus PayPal Agent Toolkit tools (`list_invoices`, `get_invoice`, `send_invoice_reminder`, `list_transactions`, `list_disputes`, `get_order` and more). The **ledger** is an AG Grid of every hold, capture, fee, payout and AI decision, each with its PayPal reference.

## The AI decides; the code keeps it honest

- **Mandates are enforced in code.** An agent's offer outside its owner's limits is rejected and retried before the other side ever sees it. Agreement requires accepting the counterparty's exact terms.
- **The verdict is computed.** The reviewer returns per-criterion findings with quoted evidence. The release happens only when every criterion is met and confidence is at least 0.6; the model never "decides to pay".
- **Deliverables are data.** Submitted content is wrapped and treated as evidence, never instructions, so a page saying "approve this" can't release money.
- **The browser can't be turned against the server.** Every request the reviewer's browser makes (including redirects and subresources) goes through an SSRF guard that blocks private and metadata addresses.
- **Mediation shares are rounded to 5% steps** and need both parties' acceptance before any capture.

## PayPal APIs used

| What | API |
| --- | --- |
| Fund a milestone (hold) | Orders v2 `intent: AUTHORIZE`, JS SDK Buttons, or the sandbox test card |
| Release / partial settle | Payments v2 capture with `final_capture` |
| Refund before capture | Payments v2 void |
| Pay the freelancer | Payouts v1 |
| Receipts | PayPal Agent Toolkit: `create_invoice`, `send_invoice`, `record_payment_for_invoice` |
| Money assistant | PayPal Agent Toolkit invoices, transactions, disputes, orders tools |
| Payout status | Webhooks with signature verification |

## Run it

```bash
npm install
npx playwright-core install chromium-headless-shell
cp .env.example .env.local   # then fill in your sandbox app credentials
npm run dev
```

AI backend: set `ANTHROPIC_API_KEY` to use the Claude API (default model `claude-opus-5-5`, override with `HANDSHAKE_MODEL`). Without a key, local development falls back to the `claude` CLI if it's installed and logged in.

Try the sample deal: open `/app`, let the agents negotiate, sign as both parties with the "Viewing as" switcher, fund with the sandbox test card, then deliver `/demo/crumb-v1` (has flaws; it fails review) and `/demo/crumb-v2` (passes and pays). For local URLs set `HANDSHAKE_ALLOW_LOCAL=1` (development only; it disables the SSRF guard).

End-to-end script against the sandbox: `npx tsx --env-file=.env.local scripts/e2e.ts`.

### Deploy

`Dockerfile` builds a standalone Next.js server on the Playwright image (Chromium included). `render.yaml` is a Render blueprint; set the secrets in the dashboard and register `https://<host>/api/webhooks/paypal` as a PayPal webhook (`PAYMENT.PAYOUTS-ITEM.*`), then set `PAYPAL_WEBHOOK_ID`.

## Stack

Next.js 15, TypeScript, Tailwind CSS 4, SQLite (better-sqlite3), AG Grid, Playwright, Anthropic SDK, PayPal Agent Toolkit.

## License

MIT
