import Link from "next/link";
import { Logo } from "@/components/logo";
import { NavLinks } from "./nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Handshake home">
            <Logo />
          </Link>
          <NavLinks />
          <span className="ml-auto hidden items-center gap-2 rounded-full border border-held/20 bg-held-soft px-3 py-1 text-xs font-medium text-held sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-held" />
            PayPal sandbox
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">{children}</main>
    </div>
  );
}
