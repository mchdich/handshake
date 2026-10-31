"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const LINKS = [
  { href: "/app", label: "Deals" },
  { href: "/app/ledger", label: "Ledger" },
  { href: "/app/assistant", label: "Assistant" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/app" ? path === "/app" || path.startsWith("/app/c") || path === "/app/new" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "rounded-full px-3 py-1.5 transition-colors",
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-line/60",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
