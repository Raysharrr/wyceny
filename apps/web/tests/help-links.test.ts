import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getPage } from "@/content/pomoc/manifest";

/**
 * Zero martwych linkow w tresci Pomocy (Slice 13, Task 14 — pierwsze zadanie,
 * ktore wstawia odnosniki do samych plikow MDX).
 *
 * Manifest pilnuje slugow uzywanych przez NAWIGACJE i przez `helpSlug` w
 * kreatorze (`help-manifest.test.ts`), ale odnosnik zapisany wprost w prozie
 * nie przechodzi przez zaden z tych mechanizmow: MDX kompiluje `[x](/pomoc/y)`
 * do zwyklego `<a>`, typy tego nie widza, dependency-cruiser tez nie. Literowka
 * w slugu daje wiec 404 dopiero pod palcem czytelnika.
 *
 * Pliki czytamy z DYSKU, a nie przez `HELP_PAGES[].load()` — glob lapie takze
 * plik MDX, ktorego nikt nie dopisal do manifestu.
 */
const CONTENT = path.join(process.cwd(), "src", "content", "pomoc");

/**
 * Wylapuje wylacznie skladnie odnosnika markdownowego. Dopasowanie na samym
 * `/pomoc/…` braloby rowniez `src="/api/pomoc/krok-3-proba.png"` z osadzonych
 * zrzutow (osiem stron instrukcji) i test czerwienilby sie na trasie obrazow,
 * ktora ze slugami Pomocy nie ma nic wspolnego.
 */
const LINK_RE = /\]\(\/pomoc\/([^)#\s]+)\)/g;

const wyciagnijSlugi = (tresc: string): string[] =>
  [...tresc.matchAll(LINK_RE)].map(([, slug]) => slug);

const zbierzMdx = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return zbierzMdx(full);
    return entry.name.endsWith(".mdx") ? [full] : [];
  });

const pliki = zbierzMdx(CONTENT).map((file) => ({
  file: path.relative(CONTENT, file),
  slugi: wyciagnijSlugi(fs.readFileSync(file, "utf8")),
}));

describe("odnosniki /pomoc/ w tresci MDX", () => {
  it("wyciaga odnosniki markdownowe, a pomija sciezki obrazow", () => {
    const probka = [
      'Zdjecia trafiaja do [dokumentacji](/pomoc/operat-i-niezmiennosc).\n<img src="/api/pomoc/krok-2-ogledziny.png" />\nGoly tekst /pomoc/nie-odnosnik.',
      "Dwa w jednym zdaniu: [a](/pomoc/metoda-kcs) i [b](/pomoc/dobor-proby-rcn).",
    ].join("\n");
    expect(wyciagnijSlugi(probka)).toEqual([
      "operat-i-niezmiennosc",
      "metoda-kcs",
      "dobor-proby-rcn",
    ]);
  });

  // Bez tej asercji zepsuty wzorzec (np. literowka w `LINK_RE`) zamienia
  // ponizszy przypadek w bezgloska atrape: pusta lista slugow przechodzi przez
  // `toEqual([])` triumfalnie i martwy link jedzie na produkcje.
  it("znajduje jakiekolwiek odnosniki w realnej tresci", () => {
    expect(pliki.flatMap((p) => p.slugi).length).toBeGreaterThan(0);
  });

  // Zweryfikowane mutacja: podmiana jednego sluga w MDX na nieistniejacy
  // czerwieni ten przypadek.
  it("kazdy odnosnik wskazuje strone istniejaca w manifescie", () => {
    const martwe = pliki.flatMap(({ file, slugi }) =>
      slugi
        .filter((slug) => getPage(slug) === undefined)
        .map((slug) => `${file} -> /pomoc/${slug}`),
    );
    expect(martwe).toEqual([]);
  });
});
