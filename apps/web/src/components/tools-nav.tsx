"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOOLS } from "@/components/tools";

const PILL = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium";

/**
 * Pills over the tool screens (`/rejestr/*`, `/narzedzia/rcn-pdf`), styled like
 * the wizard's `Stepper`. On the `/narzedzia` crossroads it renders nothing —
 * there the cards ARE the navigation. The list itself lives in
 * `components/tools.ts`, which the server-rendered crossroads also reads.
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
