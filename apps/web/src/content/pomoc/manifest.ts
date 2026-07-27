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
