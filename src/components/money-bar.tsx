import { usd } from "@/lib/client";
import type { Milestone } from "@/lib/db";
import { cx } from "./ui";

export function MoneyBar({ milestones, total }: { milestones: Milestone[]; total: number }) {
  if (!milestones.length) return <div className="h-2 rounded-full bg-line" />;
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
      {milestones.map((m) => (
        <div
          key={m.id}
          title={`${m.title}: ${usd(m.amountUsd)}`}
          style={{ width: `${(m.amountUsd / total) * 100}%` }}
          className={cx(
            "h-full",
            ["released", "settled"].includes(m.status) && "bg-paid",
            ["funded", "in_review"].includes(m.status) && "bg-held",
            ["changes_requested", "disputed"].includes(m.status) && "bg-warn",
            ["draft", "awaiting_funding", "refunded"].includes(m.status) && "bg-line-2",
          )}
        />
      ))}
    </div>
  );
}

