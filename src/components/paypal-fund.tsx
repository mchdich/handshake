"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui";

type Config = {
  paypalClientId: string;
  sandbox: boolean;
  sandboxBuyer: { email: string; password: string } | null;
};

declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
    };
  }
}

let configPromise: Promise<Config> | null = null;
let sdkPromise: Promise<void> | null = null;

function loadSdk(clientId: string) {
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&components=buttons&disable-funding=paylater,venmo,card`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Couldn't load PayPal"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/** Client funds a milestone: PayPal approves a hold (intent=AUTHORIZE). Nothing is charged until release. */
export function PayPalFund({ milestoneId, amount, onFunded }: { milestoneId: string; amount: string; onFunded: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    configPromise ??= api<Config>("/api/config");
    let buttons: { close?: () => void } | null = null;
    let cancelled = false;
    configPromise
      .then(async (c) => {
        setCfg(c);
        await loadSdk(c.paypalClientId);
        if (cancelled || !ref.current || !window.paypal) return;
        ref.current.innerHTML = "";
        const b = window.paypal.Buttons({
          style: { layout: "horizontal", color: "gold", shape: "pill", label: "paypal", height: 40, tagline: false },
          createOrder: async () => (await api<{ orderId: string }>(`/api/milestones/${milestoneId}/fund`, {})).orderId,
          onApprove: async (data: { orderID: string }) => {
            setBusy(true);
            try {
              await api(`/api/milestones/${milestoneId}/authorize`, { orderId: data.orderID });
              onFunded();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          },
          onError: (e: unknown) => setError(e instanceof Error ? e.message : "PayPal couldn't complete the hold."),
        });
        buttons = b;
        await b.render(ref.current);
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      buttons?.close?.();
    };
  }, [milestoneId, onFunded]);

  async function testCard() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/milestones/${milestoneId}/fund`, { testCard: true });
      onFunded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        Approve a <strong>{amount}</strong> hold. PayPal keeps the money aside; nobody is charged until the work passes review.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div ref={ref} className="min-h-10 w-full max-w-[260px]" />
        {cfg?.sandbox && (
          <Button variant="secondary" onClick={testCard} busy={busy}>
            <CreditCard size={15} /> Use sandbox test card
          </Button>
        )}
      </div>
      {cfg?.sandboxBuyer && (
        <p className="text-xs text-ink-3">
          Sandbox PayPal login: <span className="font-mono">{cfg.sandboxBuyer.email}</span> /{" "}
          <span className="font-mono">{cfg.sandboxBuyer.password}</span>
        </p>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
