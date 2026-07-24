import Link from "next/link";

/**
 * Sticky app chrome for `/valuations/*` (Task 3). Rendered by
 * `valuations/layout.tsx` so it covers the list, wizard, and detail pages.
 * Presentational + RSC-compatible: `children` carries the Profil link /
 * Wyloguj form supplied by the layout (advisor I5).
 */
export function Topbar({
  userName,
  userRole,
  children,
}: {
  userName: string;
  userRole: string;
  children?: React.ReactNode;
}) {
  const safeName = userName?.trim() || "—";
  const initials =
    safeName === "—"
      ? "?"
      : safeName
          .split(/\s+/)
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-4 border-b border-border bg-[color-mix(in_oklab,var(--muted)_86%,transparent)] px-6 backdrop-blur">
      <Link href="/valuations" className="flex items-center gap-3">
        <span className="grid size-[34px] place-items-center rounded-lg bg-[linear-gradient(160deg,#4a4763,#2e2c40)] text-sm font-semibold text-[#efeef5] shadow-sm">
          W
        </span>
        <span className="leading-tight">
          <span className="block text-[14.5px] font-semibold">Wyceny</span>
          <span className="block text-[11px] text-muted-foreground">operaty szacunkowe</span>
        </span>
      </Link>
      <span className="flex-1" />
      {children}
      <span className="flex items-center gap-2.5 text-[12.5px] whitespace-nowrap">
        <span className="grid size-[30px] place-items-center rounded-full border border-[var(--accent-100)] bg-[var(--accent-050)] text-xs font-semibold text-[var(--accent-700)]">
          {initials}
        </span>
        <span className="leading-tight">
          <span className="block font-medium">{safeName}</span>
          <span className="block text-muted-foreground">{userRole}</span>
        </span>
      </span>
    </header>
  );
}
