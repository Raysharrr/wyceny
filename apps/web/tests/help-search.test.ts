import { describe, expect, it } from "vitest";
import { normalize, searchIndex, stripMdx, type HelpIndexEntry } from "@/lib/help-search";

describe("stripMdx", () => {
  it("usuwa naglowki, importy i bloki kodu", () => {
    const out = stripMdx('import X from "y";\n\n## Tytul\n\n```js\nconst a = 1;\n```\n\nTresc.');
    expect(out).not.toContain("import");
    expect(out).not.toContain("const a");
    expect(out).toContain("Tytul");
    expect(out).toContain("Tresc");
  });

  it("usuwa znaczniki JSX, zostawiajac ich tresc", () => {
    expect(stripMdx("<Callout>Uwaga na zaokraglenia</Callout>")).toBe("Uwaga na zaokraglenia");
  });
});

describe("normalize", () => {
  it("usuwa diakrytyki i wielkosc liter", () => {
    expect(normalize("Księga Wieczysta")).toBe("ksiega wieczysta");
  });

  it("sklada l z kreska do l — NFD samo tego nie robi", () => {
    expect(normalize("Łąka")).toBe("laka");
  });
});

describe("searchIndex", () => {
  const index: HelpIndexEntry[] = [
    {
      slug: "a",
      title: "Próba porównawcza",
      tree: "jak-korzystac",
      tags: ["RCN"],
      text: "transakcje z rejestru",
    },
    { slug: "b", title: "Operat", tree: "metodyka", tags: [], text: "dokument koncowy" },
  ];

  it("znajduje po tresci, nie tylko po tytule", () => {
    expect(searchIndex(index, "rejestru").map((r) => r.slug)).toEqual(["a"]);
  });

  it("znajduje po tagu", () => {
    expect(searchIndex(index, "rcn").map((r) => r.slug)).toEqual(["a"]);
  });

  it("ignoruje diakrytyki w zapytaniu", () => {
    expect(searchIndex(index, "probA").map((r) => r.slug)).toEqual(["a"]);
  });

  it("zwraca pusto dla braku trafien", () => {
    expect(searchIndex(index, "hipoteka")).toEqual([]);
  });

  // Bez tej asercji mozna usunac `if (!needle) return []` i caly zestaw dalej
  // jest zielony — "hipoteka" to zapytanie niepuste, wiec nie dotyka tej
  // galezi. Puste zapytanie pasuje do KAZDEGO wpisu (`includes("")`), czyli
  // wyszukiwarka wysypywalaby cala Pomoc na pierwszy fokus w polu.
  it("zwraca pusto dla pustego zapytania", () => {
    expect(searchIndex(index, "   ")).toEqual([]);
  });
});
