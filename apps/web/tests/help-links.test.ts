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

/**
 * Nazwy przyciskow cytowane w Pomocy istnieja naprawde (T8, runda poprawek 1).
 *
 * Powod jest empiryczny: instrukcja kroku 7 dwa razy rozjechala sie po cichu z
 * aplikacja — raz po T4, raz po T8 — i za kazdym razem wykryl to dopiero
 * czlowiek czytajacy diff. Kasujac przycisk, kasuje sie jego etykiete ze
 * zrodel; ten straznik zamienia to w czerwony test zamiast w instrukcje kazaca
 * rzeczoznawcy kliknac cos, czego nie ma.
 *
 * CZEGO NIE LAPIE — spisane, bo straznik uznany za kompletny jest gorszy niz
 * jego brak (zmierzone, nie oszacowane):
 *
 *  1. **Etykieta zyjaca juz tylko w komentarzu.** Sprawdzamy tekst plikow, nie
 *     drzewo JSX, wiec skasowanie przycisku przy zostawieniu komentarza, ktory
 *     cytuje stara nazwe (np. `actions/wizard.ts:105`), przepuszcza rozjazd.
 *  2. **Etykiety poza kotwica czasownikowa.** Wzorzec zna osiem czasownikow, a
 *     Pomoc cytuje takze „Sprobuj ponownie", „Wygeneruj ponownie", „Zapisz
 *     notatke", „Wpisz recznie", „Usun" i „+ Dodaj cechę z puli…" — te nie sa
 *     pilnowane. Rozszerzanie wzorca na wszystkie cytaty (189 wystapien, 138
 *     unikatow, w wiekszosci nie-etykiety) dawaloby falszywe czerwienie.
 *  3. **Zdanie opisujace ZACHOWANIE, ktore sie zmienilo przy zywej etykiecie.**
 *     Ta klasa jest poza zasiegiem jakiegokolwiek wyrazenia regularnego.
 *
 * Sprawdzamy ISTNIENIE etykiety w zrodlach, nie jej miejsce — wiazanie
 * etykiety z konkretnym plikiem czynaloby test kruchym przy kazdym
 * przeniesieniu komponentu, a oba historyczne rozjazdy polegaly na tym, ze
 * przycisk PRZESTAL istniec.
 *
 * Zakres na dzis: 28 wystapien, 16 unikalnych etykiet. To siec bezpieczenstwa
 * na jedna, najczestsza klase bledu — nie dowod zgodnosci Pomocy z aplikacja.
 */
const ETYKIETA_RE =
  /„((?:Potwierdź|Zatwierdź|Dane się zgadzają|Pobierz|Dodaj|Utwórz|Podpisz|Wgraj)[^„”]{0,60})”/g;

const zbierzTs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return zbierzTs(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

describe("etykiety przyciskow cytowane w Pomocy", () => {
  const zrodla = [
    path.join(process.cwd(), "src", "app"),
    path.join(process.cwd(), "src", "components"),
  ]
    .flatMap(zbierzTs)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  const cytaty = zbierzMdx(CONTENT).flatMap((file) => {
    const tresc = fs.readFileSync(file, "utf8");
    return [...tresc.matchAll(ETYKIETA_RE)].map(([, etykieta]) => ({
      etykieta,
      file: path.relative(CONTENT, file),
    }));
  });

  // Bez tego pusta lista cytatow (zepsuty wzorzec) przechodzilaby ponizszy
  // przypadek triumfalnie — ta sama pulapka co przy odnosnikach wyzej. Liczby
  // sa dokladne, nie „wieksze od zera": zawezenie wzorca po cichu zmniejszyloby
  // zakres straznika, a to jest dokladnie ten rodzaj cichej utraty pokrycia,
  // przed ktorym ten plik ma bronic. Rosna, gdy Pomoc cytuje nowy przycisk —
  // wtedy zaktualizuj tez liczby w komentarzu wyzej.
  it("zna dokladny zakres: 28 wystapien, 16 unikalnych etykiet", () => {
    expect(cytaty.length).toBe(28);
    expect(new Set(cytaty.map((c) => c.etykieta)).size).toBe(16);
  });

  it("kazda cytowana etykieta wystepuje w zrodlach aplikacji", () => {
    const nieistniejace = cytaty
      .filter(({ etykieta }) => !zrodla.includes(etykieta))
      .map(({ file, etykieta }) => `${file} -> „${etykieta}”`);
    expect(nieistniejace).toEqual([]);
  });
});
