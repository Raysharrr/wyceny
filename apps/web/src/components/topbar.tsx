import Link from "next/link";
import { AvatarMenu } from "@/components/avatar-menu";

/**
 * Sticky app chrome for `/valuations/*` and `/profile` (Task 3, extended
 * Task 15). Rendered by `AppShellLayout`. Presentational + RSC-compatible:
 * the avatar on the right is `AvatarMenu`, a client island that owns the
 * "Profil i ustawienia" / "Wyloguj" dropdown (Task 15) — Topbar itself
 * needs no client-side state.
 */
export function Topbar({
  userName,
  userEmail,
  userRole,
}: {
  userName: string;
  userEmail: string;
  userRole: string;
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
      <AvatarMenu name={safeName} email={userEmail} userRole={userRole} initials={initials} />
    </header>
  );
}
