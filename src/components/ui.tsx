import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { MilestoneStatus } from "@/lib/db";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-held",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-5 text-sm",
        variant === "primary" && "bg-ink text-paper hover:bg-ink-2",
        variant === "secondary" && "border border-line-2 bg-card text-ink hover:border-ink-3",
        variant === "ghost" && "text-ink-2 hover:bg-line/60",
        variant === "danger" && "border border-bad/30 bg-bad-soft text-bad hover:border-bad/60",
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-card", className)}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{children}</div>;
}

const STATUS: Record<MilestoneStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-line/70 text-ink-2" },
  awaiting_funding: { label: "Waiting for funds", tone: "bg-line/70 text-ink-2" },
  funded: { label: "Held by PayPal", tone: "bg-held-soft text-held" },
  in_review: { label: "AI reviewing", tone: "bg-held-soft text-held" },
  changes_requested: { label: "Changes requested", tone: "bg-warn-soft text-warn" },
  disputed: { label: "In mediation", tone: "bg-warn-soft text-warn" },
  released: { label: "Paid", tone: "bg-paid-soft text-paid" },
  settled: { label: "Settled", tone: "bg-paid-soft text-paid" },
  refunded: { label: "Returned to client", tone: "bg-line/70 text-ink-2" },
};

export function StatusPill({ status }: { status: MilestoneStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", s.tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line-2 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none focus:ring-2 focus:ring-held/15";
