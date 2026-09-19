"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Narzędzia biura — JEDNA lista: czytają ją karty na `/narzedzia` i zakładki
 * `ToolsNav`. Nowe narzędzie = jeden wpis tutaj + `ToolsLayout` w jego trasie.
 */
export const TOOLS = [
  {
    href: "/rejestr",
    label: "Rejestr spółdzielczy",
    description:
      "Transakcje spółdzielczego własnościowego prawa do lokalu z arkuszy spółdzielni — z nich krok 3 dobiera próbę, bo takich transakcji nie ma w RCN.",
  },
] as const;

/** Wewnętrzna nawigacja widoku Narzędzia: zakładki nad każdą stroną narzędzia. */
export function ToolsNav() {
  const pathname = usePathname();
  const tabs = [{ href: "/narzedzia", label: "Wszystkie narzędzia" }, ...TOOLS];
  return (
    <nav aria-label="Narzędzia" className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[1240px] gap-1 px-6">
        {tabs.map((t) => {
          const active =
            t.href === "/narzedzia" ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-3 text-[13.5px] font-medium ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
