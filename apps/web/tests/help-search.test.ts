import { describe, expect, it } from "vitest";
import {
  buildIndex,
  normalize,
  searchIndex,
  stripMdx,
  type HelpIndexEntry,
} from "@/lib/help-search";
import type { HelpPage } from "@/content/pomoc/manifest";

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

  // Task 14 wstawil odnosniki do tresci. Bez tego przejscia adres celu trafia
  // do indeksu jako proza (mysliniki zamieniaja sie w spacje), wiec zapytanie
  // "pomoc" pasowaloby do kazdej strony z jakimkolwiek odnosnikiem.
  it("zwija odnosniki do samego tekstu, bez adresu", () => {
    const out = stripMdx("Opisuje je [Metoda KCS](/pomoc/metoda-kcs).");
    expect(out).toBe("Opisuje je Metoda KCS.");
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

// Bramka spojnosci manifest<->pliki byla wczesniej zaszyta w skrypcie `.mts`,
// ktorego zaden test nie importuje: niezalezny przeglad usunal OBA `throw` i
// caly pakiet pozostal zielony. Kazda asercja ponizej celuje we FRAGMENT
// komunikatu, nie w sam fakt rzucenia — inaczej jeden `throw` maskowalby drugi.
describe("buildIndex", () => {
  const page = (slug: string, over: Partial<HelpPage> = {}): HelpPage => ({
    slug,
    title: `Tytul ${slug}`,
    tree: "jak-korzystac",
    order: 1,
    tags: ["tag"],
    summary: slug,
    load: async () => ({ default: () => null }),
    ...over,
  });

  it("przepisuje metadane z manifestu i oczyszcza tresc pliku", () => {
    const wynik = buildIndex(
      [
        {
          slug: "a",
          file: "jak-korzystac/a.mdx",
          text: 'import X from "y";\n\n## Naglowek\n\nTresc.',
        },
      ],
      [page("a", { title: "Pierwsze kroki", tree: "metodyka", tags: ["konto"] })],
    );
    expect(wynik).toEqual([
      {
        slug: "a",
        title: "Pierwsze kroki",
        tree: "metodyka",
        tags: ["konto"],
        text: "Naglowek Tresc.",
      },
    ]);
  });

  it("odrzuca plik bez wpisu w manifescie — inaczej strona-widmo trafia do wynikow i 404-uje po kliknieciu", () => {
    expect(() =>
      buildIndex([{ slug: "widmo", file: "jak-korzystac/widmo.mdx", text: "x" }], []),
    ).toThrow(/widmo\.mdx nie ma wpisu w manifest\.ts/);
  });

  it("odrzuca wpis w manifescie bez pliku — inaczej nawigacja linkuje do pustej strony", () => {
    expect(() => buildIndex([], [page("sierota")])).toThrow(
      /Manifest wymienia strony bez pliku MDX: sierota/,
    );
  });

  it("nazywa po imieniu kolizje nazw plikow z roznych katalogow", () => {
    const kolizja = () =>
      buildIndex(
        [
          { slug: "zaokraglenia", file: "jak-korzystac/zaokraglenia.mdx", text: "x" },
          { slug: "zaokraglenia", file: "metodyka/zaokraglenia.mdx", text: "y" },
        ],
        [page("zaokraglenia")],
      );
    // Slug bierze sie z samej nazwy pliku, wiec te dwa kolidują. Poprzednia
    // wersja skryptu zglaszala wtedy „brak wpisu w manifescie" (wpis zuzyl juz
    // pierwszy plik) i wysylala autora tresci pod zly adres; ta bramka to
    // jedyne, co kolizje w ogole wykrywa. Asercje ida na fragment komunikatu i
    // na obie sciezki — sam `toThrow()` przechodzilby takze dla mylacej galezi.
    expect(kolizja).toThrow(/ten sam slug/);
    expect(kolizja).toThrow(/jak-korzystac\/zaokraglenia\.mdx/);
    expect(kolizja).toThrow(/metodyka\/zaokraglenia\.mdx/);
  });
});
