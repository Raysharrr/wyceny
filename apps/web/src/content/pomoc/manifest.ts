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
  {
    slug: "krok-4-cechy",
    title: "Krok 4 — Cechy, oceny i wagi",
    tree: "jak-korzystac",
    order: 5,
    tags: [
      "cechy",
      "wagi",
      "oceny",
      "definicje skali ocen",
      "pula cech",
      "ΣUi",
      "standard wykończenia",
    ],
    summary: "Gotowy zestaw sześciu cech z wagami, oceny lokalu i definicje skali ocen.",
    load: () => import("./jak-korzystac/krok-4-cechy.mdx"),
  },
  {
    slug: "krok-5-kalkulacja",
    title: "Krok 5 — Kalkulacja",
    tree: "jak-korzystac",
    order: 6,
    tags: ["kalkulacja", "wartość rynkowa", "WR", "Cśr", "ΣUi", "tabele operatu", "zatwierdzenie"],
    summary: "Wynik liczony z próby i ocen; kwota zapisuje się dopiero po zatwierdzeniu.",
    load: () => import("./jak-korzystac/krok-5-kalkulacja.mdx"),
  },
  {
    slug: "krok-6-opisy",
    title: "Krok 6 — Sekcje opisowe",
    tree: "jak-korzystac",
    order: 7,
    tags: ["opisy", "sekcje opisowe", "szablon", "uwagi z oględzin", "proza"],
    summary: "Krok przelotowy — opisy powstają z szablonu przy zatwierdzeniu.",
    load: () => import("./jak-korzystac/krok-6-opisy.mdx"),
  },
  {
    slug: "krok-7-operat",
    title: "Krok 7 — Operat",
    tree: "jak-korzystac",
    order: 8,
    tags: [
      "operat",
      "zatwierdzenie",
      "blokady",
      "potwierdzenia",
      "mapy",
      "PDF",
      "DOCX",
      "kwota słownie",
    ],
    summary: "Potwierdzenia danych, lista blokad i wygenerowanie operatu w PDF oraz DOCX.",
    load: () => import("./jak-korzystac/krok-7-operat.mdx"),
  },
  {
    slug: "po-zatwierdzeniu",
    title: "Po zatwierdzeniu — podpis i nowa wersja",
    tree: "jak-korzystac",
    order: 9,
    tags: ["podpis", "skan podpisu", "nowa wersja", "pobieranie", "status", "profil"],
    summary: "Widok dokumentu, podpisanie operatu i tworzenie nowej wersji podpisanej wyceny.",
    load: () => import("./jak-korzystac/po-zatwierdzeniu.mdx"),
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
