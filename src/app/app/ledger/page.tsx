"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { ago, api, usd2 } from "@/lib/client";
import type { LedgerEvent, Milestone } from "@/lib/db";
import { Card, cx, Label, StatusPill } from "@/components/ui";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  backgroundColor: "#fffdf9",
  foregroundColor: "#1b1813",
  headerBackgroundColor: "#f7f4ee",
  headerTextColor: "#6b6459",
  borderColor: "#e8e2d6",
  rowHoverColor: "#f7f4ee",
  accentColor: "#1f4fd8",
  wrapperBorderRadius: 16,
  headerFontWeight: 500,
  rowBorder: { color: "#efeae0" },
  spacing: 7,
});

type Ev = LedgerEvent & { contract?: string };
type Ms = Milestone & { contract: string };
type Data = {
  totals: { held: number; captured: number; fees: number; paidOut: number; returned: number };
  events: Ev[];
  milestones: Ms[];
};

const FLOW: Record<string, string> = {
  "funds.held": "text-held",
  "funds.captured": "text-ink",
  "payout.sent": "text-paid",
  "payout.succeeded": "text-paid",
  "funds.released": "text-ink-2",
  "funds.voided": "text-ink-2",
};

const ACTOR: Record<string, string> = {
  client: "Client",
  freelancer: "Freelancer",
  paypal: "PayPal",
  handshake: "Handshake",
  "agent:negotiators": "Negotiator agents",
  "agent:reviewer": "Review agent",
  "agent:mediator": "Mediator agent",
  "agent:paypal-toolkit": "PayPal Agent Toolkit",
};

export default function Ledger() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"events" | "milestones">("events");
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Data>("/api/ledger").then(setData, (e) => setError(e.message));
  }, []);

  const eventCols = useMemo<ColDef<Ev>[]>(
    () => [
      {
        field: "at",
        headerName: "When",
        width: 170,
        sort: "desc",
        valueFormatter: (p) => new Date(p.value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }),
        tooltipValueGetter: (p) => ago(p.data!.at),
      },
      {
        field: "type",
        headerName: "Event",
        width: 160,
        filter: true,
        cellRenderer: (p: ICellRendererParams<Ev>) => <span className={cx("font-mono text-[12px]", FLOW[p.value] ?? "text-ink-2")}>{p.value}</span>,
      },
      { field: "actor", headerName: "By", width: 170, filter: true, valueFormatter: (p) => ACTOR[p.value] ?? p.value },
      {
        field: "amountUsd",
        headerName: "Amount",
        width: 120,
        type: "rightAligned",
        cellClass: ["tabular", "ag-right-aligned-cell"],
        valueFormatter: (p) => (p.value == null ? "" : usd2(p.value)),
      },
      { field: "detail", headerName: "What happened", flex: 2, minWidth: 280, tooltipField: "detail" },
      { field: "contract", headerName: "Contract", flex: 1, minWidth: 160, filter: true },
      {
        field: "ref",
        headerName: "PayPal reference",
        width: 200,
        cellRenderer: (p: ICellRendererParams<Ev>) => <span className="font-mono text-[11px] text-ink-3">{p.value}</span>,
      },
    ],
    [],
  );

  const milestoneCols = useMemo<ColDef<Ms>[]>(
    () => [
      {
        field: "contract",
        headerName: "Contract",
        rowGroup: false,
        flex: 1,
        minWidth: 180,
        filter: true,
        cellRenderer: (p: ICellRendererParams<Ms>) => (
          <Link className="underline-offset-4 hover:underline" href={`/app/c/${p.data!.contractId}`}>
            {p.value}
          </Link>
        ),
      },
      { field: "title", headerName: "Milestone", flex: 1.4, minWidth: 220 },
      { field: "status", headerName: "Status", width: 170, filter: true, cellRenderer: (p: ICellRendererParams<Ms>) => <StatusPill status={p.value} /> },
      { field: "amountUsd", headerName: "Amount", width: 110, type: "rightAligned", cellClass: ["tabular", "ag-right-aligned-cell"], valueFormatter: (p) => usd2(p.value) },
      { colId: "captured", headerName: "Captured", width: 110, type: "rightAligned", cellClass: ["tabular", "ag-right-aligned-cell"], valueGetter: (p) => p.data!.paypal.capturedUsd, valueFormatter: (p) => (p.value == null ? "" : usd2(p.value)) },
      { colId: "fee", headerName: "PayPal fee", width: 110, type: "rightAligned", cellClass: ["tabular", "ag-right-aligned-cell"], valueGetter: (p) => p.data!.paypal.feeUsd, valueFormatter: (p) => (p.value == null ? "" : usd2(p.value)) },
      { colId: "paid", headerName: "Paid out", width: 110, type: "rightAligned", cellClass: ["tabular", "ag-right-aligned-cell"], valueGetter: (p) => p.data!.paypal.payoutUsd, valueFormatter: (p) => (p.value == null ? "" : usd2(p.value)) },
      { colId: "conf", headerName: "AI confidence", width: 130, type: "rightAligned", valueGetter: (p) => (p.data!.review ? Math.round(p.data!.review.confidence * 100) : null), valueFormatter: (p) => (p.value == null ? "" : `${p.value}%`) },
      { field: "attempts", headerName: "Deliveries", width: 110, type: "rightAligned" },
      { colId: "order", headerName: "PayPal order", width: 190, valueGetter: (p) => p.data!.paypal.orderId, cellClass: "font-mono text-[11px] text-ink-3" },
      { colId: "invoice", headerName: "Invoice", width: 210, valueGetter: (p) => p.data!.paypal.invoiceId, cellClass: "font-mono text-[11px] text-ink-3" },
    ],
    [],
  );

  const events = useMemo(
    () => (moneyOnly ? data?.events.filter((e) => e.amountUsd != null) : data?.events) ?? [],
    [data, moneyOnly],
  );

  const t = data?.totals;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">Ledger</h1>
        <p className="mt-1 text-sm text-ink-2">Every hold, capture, fee, payout and AI decision, with the PayPal id behind it.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Held by PayPal", t?.held, "text-held"],
          ["Captured", t?.captured, "text-ink"],
          ["PayPal fees", t?.fees, "text-ink-2"],
          ["Paid to freelancers", t?.paidOut, "text-paid"],
          ["Returned to clients", t?.returned, "text-ink-2"],
        ].map(([label, v, cls]) => (
          <Card key={label as string} className="p-4">
            <Label>{label}</Label>
            <div className={cx("tabular mt-1 text-xl font-semibold", cls as string)}>{v == null ? "—" : usd2(v as number)}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-full border border-line bg-card p-1 text-sm" role="tablist">
          {(["events", "milestones"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("rounded-full px-3.5 py-1.5 capitalize", tab === k ? "bg-ink text-paper" : "text-ink-2 hover:bg-line/60")}
            >
              {k}
            </button>
          ))}
        </div>
        {tab === "events" && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={moneyOnly} onChange={(e) => setMoneyOnly(e.target.checked)} className="accent-held" />
            Money movements only
          </label>
        )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="h-[560px]">
        {tab === "events" ? (
          <AgGridReact<Ev> theme={theme} rowData={events} columnDefs={eventCols} getRowId={(p) => p.data.id} tooltipShowDelay={300} loading={!data} pagination paginationPageSize={50} />
        ) : (
          <AgGridReact<Ms> theme={theme} rowData={data?.milestones ?? []} columnDefs={milestoneCols} getRowId={(p) => p.data.id} loading={!data} />
        )}
      </div>
    </div>
  );
}
