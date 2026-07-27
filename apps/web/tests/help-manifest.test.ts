import { describe, expect, it } from "vitest";
import { HELP_PAGES, getPage, pagesInTree } from "@/content/pomoc/manifest";

describe("manifest Pomocy", () => {
  it("ma unikalne slugi", () => {
    const slugs = HELP_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("kazda strona ma tytul, drzewo i streszczenie", () => {
    expect(HELP_PAGES.length).toBeGreaterThan(0);
    for (const page of HELP_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(["jak-korzystac", "metodyka"]).toContain(page.tree);
      expect(page.summary.length).toBeGreaterThan(0);
    }
  });

  // The only guard against a mistyped MDX path: dependency-cruiser has no
  // `no-unresolved` rule here, so a bad `import("./…mdx")` sails through the
  // F-10 gate and only blows up when a reader opens the page.
  it("kazda strona da sie zaladowac", async () => {
    for (const page of HELP_PAGES) {
      const mod = await page.load();
      expect(typeof mod.default).toBe("function");
    }
  });

  it("getPage zwraca wpis dla znanego sluga", () => {
    expect(getPage("pierwsze-kroki")?.title).toBe("Pierwsze kroki");
  });

  it("getPage zwraca undefined dla nieznanego sluga", () => {
    expect(getPage("nie-ma-takiej")).toBeUndefined();
  });

  // Deliberately phrased against whatever the manifest holds: later tasks add
  // pages to both trees, and a test pinned to today's counts would go red for
  // the wrong reason.
  it.each(["jak-korzystac", "metodyka"] as const)("pagesInTree(%s) filtruje i sortuje", (tree) => {
    const pages = pagesInTree(tree);
    expect(pages.every((page) => page.tree === tree)).toBe(true);
    expect(pages).toHaveLength(HELP_PAGES.filter((page) => page.tree === tree).length);
    const orders = pages.map((page) => page.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
