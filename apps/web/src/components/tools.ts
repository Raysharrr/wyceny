import { FileSpreadsheet, Table2, type LucideIcon } from "lucide-react";

/**
 * The office tools — ONE list behind the in-tool nav (`ToolsNav`) and the cards
 * on `/narzedzia` (T-22, user's decision 19.09: the cooperative register is a
 * tool too). The app header carries no nav items any more; the way in is the
 * avatar menu → Narzędzia.
 *
 * This list lives in its own module ON PURPOSE. `tools-nav.tsx` is a client
 * island, and a plain value exported from a `"use client"` module reaches a
 * Server Component as a client reference, not as the array — the crossroads
 * page would crash with "TOOLS.map is not a function". Keeping the data here
 * lets both sides of the boundary import the same real array.
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
