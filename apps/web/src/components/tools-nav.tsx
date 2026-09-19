"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, Table2, type LucideIcon } from "lucide-react";

/**
 * The office tools — ONE list behind both the in-tool nav below and the cards
 * on `/narzedzia` (T-22, user's decision 19.09: the cooperative register is a
 * tool too). The app header carries no nav items any more; the way in is the
 * avatar menu → Narzędzia.
 */
export const TOOLS: readonly {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    href: "/rejestr",
    label: "Rejestr spółdzielczy",
    description:
      "Wspólny rejestr transakcji ze spółdzielni mieszkaniowych — przeglądanie i import z plików XLS.",
    icon: Table2,
  },
  {
    href: "/narzedzia/rcn-pdf",
    label: "Wydruk z RCN → Excel",
    description:
      "Wgraj PDF z transakcjami pobrany z portalu powiatu i pobierz gotowy arkusz — bez przepisywania.",
    icon: FileSpreadsheet,
  },
];

const PILL = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium";

/**
 * Pills over the tool screens (`/rejestr/*`, `/narzedzia/rcn-pdf`), styled like
 * the wizard's `Stepper`. On the `/narzedzia` crossroads it renders nothing —
 * there the cards ARE the navigation.
 */
export function ToolsNav() {
  const pathname = usePathname();
  if (pathname === "/narzedzia") return null;
  return (
    <nav
      aria-label="Narzędzia"
      className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-2 px-6 pt-10"
    >
      {TOOLS.map(({ href, label, icon: Icon }) => {
        const current = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`${PILL} ${
              current
                ? "border-transparent bg-[var(--accent-700)] text-[#fafafa]"
                : "border-border bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
