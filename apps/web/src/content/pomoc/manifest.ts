import type { ComponentType } from "react";

export type HelpTree = "jak-korzystac" | "metodyka";

export type HelpPage = {
  slug: string;
  title: string;
  tree: HelpTree;
  order: number;
  tags: string[];
  summary: string;
  load: () => Promise<{ default: ComponentType }>;
};

export const TREE_LABEL: Record<HelpTree, string> = {
  "jak-korzystac": "Jak korzystać",
  metodyka: "Na czym opieramy wynik",
};

/**
 * The single source of Pomoc's navigation structure (Slice 13, Task 2).
 * Every later task appends entries here alongside its `.mdx` file.
 *
 * The `import()` targets MUST stay static string literals — a path built from
 * a variable is invisible to the bundler, so the chunk never ships and the
 * page 500s at runtime.
 */
export const HELP_PAGES: HelpPage[] = [
  {
    slug: "pierwsze-kroki",
    title: "Pierwsze kroki",
    tree: "jak-korzystac",
    order: 1,
    tags: ["konto", "lista wycen", "start"],
    summary: "Logowanie, lista wycen i utworzenie pierwszej wyceny.",
    load: () => import("./jak-korzystac/pierwsze-kroki.mdx"),
  },
  {
    slug: "krok-1-przedmiot",
    title: "Krok 1 — Dane przedmiotu",
    tree: "jak-korzystac",
    order: 2,
    tags: [
      "adres",
      "powierzchnia",
      "księga wieczysta",
      "KW",
      "akt notarialny",
      "MPZP",
      "EGiB",
      "działka",
      "cel wyceny",
      "zamawiający",
    ],
    summary:
      "Adres uruchamia pobranie danych działki, budynku i planu; KW z dokumentu albo z ręki.",
    load: () => import("./jak-korzystac/krok-1-przedmiot.mdx"),
  },
  {
    slug: "krok-2-ogledziny",
    title: "Krok 2 — Oględziny",
    tree: "jak-korzystac",
    order: 3,
    tags: [
      "oględziny",
      "zdjęcia",
      "fotografie",
      "notatka",
      "data oględzin",
      "GPS",
      "dokumentacja fotograficzna",
    ],
    summary: "Data wizyty, zdjęcia w trzech sekcjach i notatka — jedyny krok bez automatyzacji.",
    load: () => import("./jak-korzystac/krok-2-ogledziny.mdx"),
  },
  {
    slug: "krok-3-proba",
    title: "Krok 3 — Próba porównawcza",
    tree: "jak-korzystac",
    order: 4,
    tags: ["próba", "transakcje", "RCN", "porównawcze", "zł/m²", "Cśr", "12 transakcji"],
    summary: "Pobranie transakcji z RCN, ręczne uzupełnienia i wymagana liczebność próby.",
    load: () => import("./jak-korzystac/krok-3-proba.mdx"),
  },
];

export const getPage = (slug: string): HelpPage | undefined =>
  HELP_PAGES.find((page) => page.slug === slug);

/**
 * Pure, injectable sort so the ordering is actually testable. Asserting that
 * `pagesInTree(...)` returns ascending pages proves nothing while the manifest
 * is authored in ascending order: an independent review deleted the `.sort()`
 * and every test stayed green. Callers keep using `pagesInTree`.
 */
export const sortPages = (pages: HelpPage[]): HelpPage[] =>
  [...pages].sort((a, b) => a.order - b.order);

export const pagesInTree = (tree: HelpTree): HelpPage[] =>
  sortPages(HELP_PAGES.filter((page) => page.tree === tree));
