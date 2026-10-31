// Thin PayPal REST client for the escrow flow: Orders v2 (intent AUTHORIZE),
// Payments v2 (capture / void authorizations), Payouts v1 and webhook verification.
// The AI agents use the official @paypal/agent-toolkit on top of this (see paypal-agent.ts).

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

let cached: { token: string; expires: number } | null = null;

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalError("oauth", res.status, await res.text());
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export class PayPalError extends Error {
  constructor(
    public op: string,
    public status: number,
    public body: string,
  ) {
    super(`PayPal ${op} failed (${status}): ${body.slice(0, 400)}`);
  }
  get details(): { issue?: string; description?: string }[] {
    try {
      return JSON.parse(this.body).details ?? [];
    } catch {
      return [];
    }
  }
}

async function call<T>(
  op: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(op, res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

export const isSandbox = () => BASE.includes("sandbox");

/** PayPal's published sandbox test Visa. Never valid in production. */
const SANDBOX_TEST_CARD = {
  number: "4012888888881881",
  expiry: "2030-12",
  security_code: "123",
  name: "Sandbox Tester",
  billing_address: {
    address_line_1: "2211 N First St",
    admin_area_2: "San Jose",
    admin_area_1: "CA",
    postal_code: "95131",
    country_code: "US",
  },
};

const money = (usd: number) => ({ currency_code: "USD", value: usd.toFixed(2) });

export type Order = {
  id: string;
  status: string;
  purchase_units: {
    reference_id?: string;
    payments?: {
      authorizations?: Authorization[];
      captures?: Capture[];
    };
  }[];
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
};

export type Authorization = {
  id: string;
  status: string;
  amount: { value: string; currency_code: string };
  expiration_time?: string;
};

export type Capture = {
  id: string;
  status: string;
  amount: { value: string; currency_code: string };
  seller_receivable_breakdown?: {
    gross_amount: { value: string };
    paypal_fee?: { value: string };
    net_amount: { value: string };
  };
};

/** Escrow step 1: an order the client approves in the PayPal popup. Funds are held, not taken. */
export function createEscrowOrder(opts: {
  milestoneId: string;
  amountUsd: number;
  description: string;
  requestId: string;
  /** Sandbox only: pay with PayPal's test Visa, which authorizes without a popup. */
  testCard?: boolean;
}) {
  if (opts.testCard && !isSandbox()) throw new Error("Test cards only work in the sandbox");
  return call<Order>(
    "create order",
    "POST",
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: opts.milestoneId,
          custom_id: opts.milestoneId,
          description: opts.description.slice(0, 127),
          soft_descriptor: "HANDSHAKE",
          amount: money(opts.amountUsd),
        },
      ],
      payment_source: opts.testCard
        ? { card: SANDBOX_TEST_CARD }
        : {
            paypal: {
              experience_context: {
                brand_name: "Handshake",
                shipping_preference: "NO_SHIPPING",
                user_action: "CONTINUE",
              },
            },
          },
    },
    { "PayPal-Request-Id": opts.requestId },
  );
}

/** Escrow step 2: after the client approves, place the hold. */
export function authorizeOrder(orderId: string, requestId: string) {
  return call<Order>("authorize order", "POST", `/v2/checkout/orders/${orderId}/authorize`, {}, {
    "PayPal-Request-Id": requestId,
  });
}

export function getOrder(orderId: string) {
  return call<Order>("get order", "GET", `/v2/checkout/orders/${orderId}`);
}

/** Release: take some or all of the held money. final=true closes the authorization. */
export function captureAuthorization(opts: {
  authorizationId: string;
  amountUsd: number;
  final: boolean;
  note: string;
  requestId: string;
}) {
  return call<Capture>(
    "capture",
    "POST",
    `/v2/payments/authorizations/${opts.authorizationId}/capture`,
    {
      amount: money(opts.amountUsd),
      final_capture: opts.final,
      note_to_payer: opts.note.slice(0, 255),
    },
    { "PayPal-Request-Id": opts.requestId },
  );
}

/** Give the hold back to the client (cancelled or lost milestone). */
export function voidAuthorization(authorizationId: string) {
  return call<Record<string, never>>(
    "void",
    "POST",
    `/v2/payments/authorizations/${authorizationId}/void`,
  );
}

export function getAuthorization(authorizationId: string) {
  return call<Authorization>("get authorization", "GET", `/v2/payments/authorizations/${authorizationId}`);
}

export type PayoutBatch = {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    amount?: { value: string };
    fees?: { value: string };
  };
  items?: { payout_item_id: string; transaction_status: string; transaction_id?: string }[];
};

/** Pay the freelancer from the platform balance. */
export function sendPayout(opts: {
  batchId: string;
  receiverEmail: string;
  amountUsd: number;
  note: string;
  itemId: string;
}) {
  return call<PayoutBatch>("payout", "POST", "/v1/payments/payouts", {
    sender_batch_header: {
      sender_batch_id: opts.batchId,
      email_subject: "You've been paid through Handshake",
      email_message: opts.note.slice(0, 1000),
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { currency: "USD", value: opts.amountUsd.toFixed(2) },
        receiver: opts.receiverEmail,
        note: opts.note.slice(0, 4000),
        sender_item_id: opts.itemId,
      },
    ],
  });
}

export function getPayout(batchId: string) {
  return call<PayoutBatch>("get payout", "GET", `/v1/payments/payouts/${batchId}`);
}

export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const res = await call<{ verification_status: string }>(
    "verify webhook",
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    },
  );
  return res.verification_status === "SUCCESS";
}
