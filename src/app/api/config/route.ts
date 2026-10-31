import { NextResponse } from "next/server";
import { backend } from "@/lib/llm";
import { isSandbox, paypalConfigured } from "@/lib/paypal";

export async function GET() {
  return NextResponse.json({
    paypalClientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID,
    paypalReady: paypalConfigured(),
    sandbox: isSandbox(),
    ai: backend(),
    sandboxBuyer: process.env.HANDSHAKE_SANDBOX_BUYER_EMAIL
      ? { email: process.env.HANDSHAKE_SANDBOX_BUYER_EMAIL, password: process.env.HANDSHAKE_SANDBOX_BUYER_PASSWORD }
      : null,
  });
}
