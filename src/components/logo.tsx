export function Logo({ className = "" }: { className?: string }) {
  // Two interlocking rings: two parties, one agreement.
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="26" height="18" viewBox="0 0 26 18" fill="none" aria-hidden>
        <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" />
        <circle cx="17" cy="9" r="7" stroke="var(--seal)" strokeWidth="2" />
      </svg>
      <span className="font-display text-[22px] leading-none">Handshake</span>
    </span>
  );
}
