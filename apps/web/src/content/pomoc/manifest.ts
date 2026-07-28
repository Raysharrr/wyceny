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
  {
    slug: "metoda-kcs",
    title: "Metoda KCS — korygowanie ceny średniej",
    tree: "metodyka",
    order: 1,
    tags: [
      "KCS",
      "korygowanie ceny średniej",
      "podejście porównawcze",
      "Cśr",
      "Vmin",
      "Vmax",
      "ΣUi",
      "zaokrąglenia",
      "wartość jednostkowa",
      "wartość rynkowa",
    ],
    summary:
      "Jak z próby powstaje cena średnia, granice korekty i wartość rynkowa — z konwencją zaokrągleń operatu.",
    load: () => import("./metodyka/metoda-kcs.mdx"),
  },
  /**
   * Uwaga dla utrzymujących treść (ograniczenie R1 ze specu): stałe doboru
   * próby żyją w workerze (Python), więc `dobor-proby-rcn.mdx` przepisuje je
   * ręcznie — importowalny jest tylko web-owy `REQUIRED_SAMPLE_SIZE`
   * (`@/domain/provenance`, brama zatwierdzenia). Komentarz stoi tutaj, a nie
   * w samym MDX, bo prettier formatuje `.mdx` markdownowo i przerabia
   * `{/* … *\/}` na `{/_ … _/}` — plik przestaje się kompilować, a CI (`pnpm
   * format:check`) i tak wywala różnicę.
   *
   * Źródła do sprawdzenia przy każdej zmianie doboru:
   *   apps/worker/app/rcn.py:27   POOL_N = 19
   *   apps/worker/app/rcn.py:28   AREA_BAND_PCT = 0.30
   *   apps/worker/app/rcn.py:29   DATE_WINDOW_MONTHS = 24
   *   apps/worker/app/rcn.py:32   WFS_URL (RCN w Geoportalu)
   *   apps/worker/app/rcn.py:33   NOMINATIM (geokoder)
   *   apps/worker/app/rcn.py:109  próg 8 rekordów dla przycinania IQR
   *   apps/worker/app/main.py:125 bbox ±0.018° / ±0.029°
   *   apps/worker/app/main.py:135 próg 12 wybranych transakcji przy pobraniu
   *   apps/worker/app/main.py:159 count=5000, sortBy="dok_data D"
   *   apps/web/src/app/valuations/[id]/steps/step-sample.tsx:171 slice(0, 12)
   */
  {
    slug: "dobor-proby-rcn",
    title: "Dobór próby porównawczej z RCN",
    tree: "metodyka",
    order: 2,
    tags: [
      "RCN",
      "rejestr cen nieruchomości",
      "Geoportal",
      "GUGiK",
      "WFS",
      "geokodowanie",
      "pasmo metrażu",
      "okno czasowe",
      "IQR",
      "odstające",
      "12 transakcji",
    ],
    summary:
      "Skąd pochodzą transakcje, jakie filtry przechodzą i dlaczego próba liczy dwanaście pozycji.",
    load: () => import("./metodyka/dobor-proby-rcn.mdx"),
  },
  /**
   * Uwaga dla utrzymujących treść: WSZYSTKIE progi i adresy usług cytowane w
   * `zrodla-danych-przedmiotu.mdx` mieszkają w workerze (Python), więc strona
   * przepisuje je ręcznie — nie ma tu czego zaimportować. Komentarz stoi w
   * manifeście, nie w MDX, z powodu opisanego przy `dobor-proby-rcn` powyżej.
   *
   * Źródła do sprawdzenia przy każdej zmianie pobrania danych przedmiotu:
   *   apps/worker/app/subject.py:34   normalize_uug_address (miasto pierwsze, obcięcie nr lokalu)
   *   apps/worker/app/subject.py:100  pick_mpzp_function — symbol przez MAX przecięcia
   *   apps/worker/app/subject.py:116  pick_plan — metryka planu przez punkt w wielokącie
   *   apps/worker/app/subject.py:132  is_poznan — zasięg MVP, prefiks TERYT 3064
   *   apps/worker/app/subject.py:139  GEOKODER_URL (UUG GUGiK)
   *   apps/worker/app/subject.py:140  ULDK_URL (identyfikator + geometria działki)
   *   apps/worker/app/subject.py:141  GEOPOZ_WMS_URL (EGiB: dzialki, budynki)
   *   apps/worker/app/subject.py:142  GEOPOZ_WFS_URL (mpzp_poznan:mpzp_funkcje)
   *   apps/worker/app/subject.py:143  PLANS_URL (miejska warstwa metryk planów)
   *   apps/worker/app/subject.py:145  PLANS_CACHE_TTL_S = 3600 s
   *   apps/worker/app/subject.py:197  half = 50.0 — kwadrat zapytania GetFeatureInfo
   *   apps/worker/app/subject.py:212  FEATURE_COUNT = 10
   *   apps/worker/app/subject.py:227  count = 50 (limit obiektów WFS funkcji)
   *   apps/worker/app/subject.py:75   parcel_from_xml — lista pól EGiB działki
   *   apps/worker/app/subject.py:89   building_from_xml — lista pól EGiB budynku
   *   apps/worker/app/main.py:239     mpzp niepuste, gdy zadziała funkcja LUB plan
   *   apps/worker/app/maps.py:19-24   ORTO/KIEG, 1800x1350, 125 m, skala 2x
   *   apps/worker/app/maps.py:53      attempts = 4 (ORTO losowo 404)
   *   apps/web/src/domain/document-model.ts:277  hasMpzp — WŁASNY, ostrzejszy warunek dokumentu
   *   apps/web/src/lib/assign-provenance.ts:18   statusy nadawane serwerowo (ADR-010)
   */
  {
    slug: "zrodla-danych-przedmiotu",
    title: "Źródła danych o przedmiocie wyceny",
    tree: "metodyka",
    order: 3,
    tags: [
      "EGiB",
      "ewidencja gruntów i budynków",
      "MPZP",
      "plan miejscowy",
      "studium",
      "decyzja WZ",
      "GUGiK",
      "GEOPOZ",
      "ULDK",
      "geokoder",
      "TERYT",
      "WMS",
      "WFS",
      "mapa ewidencyjna",
      "ortofotomapa",
      "działka",
      "budynek",
      "zasięg",
    ],
    summary:
      "Z jakich rejestrów pochodzą dane działki, budynku i planu, skąd biorą się mapy i dokąd sięga zasięg pobrania.",
    load: () => import("./metodyka/zrodla-danych-przedmiotu.mdx"),
  },
  /**
   * Uwaga dla utrzymujących treść: limit 32 MB istnieje w DWÓCH miejscach —
   * kontraktem jest stała workera, literał w formularzu to tylko wcześniejsza
   * bramka w przeglądarce. Strona mówi o obu; nie scalać ich w jedną liczbę i
   * nie importować literału z web (opisywałby wtedy UX, nie zachowanie
   * workera). `TOKEN_TTL_SECONDS` jest w module "use server" — import do MDX
   * wciągnąłby server action do bundla strony, więc też przepisany prozą.
   *
   * Źródła do sprawdzenia przy każdej zmianie ekstrakcji:
   *   apps/worker/app/kw.py:18        MAX_PDF_BYTES = 32 MB (limit API modelu)
   *   apps/worker/app/kw.py:20        PESEL_RE — 11 cyfr
   *   apps/worker/app/kw.py:25        PERSON_CTX_RE — lista słów kontekstu osoby
   *   apps/worker/app/kw.py:29        SCRUB_MARK = "[dane osobowe usunięte]"
   *   apps/worker/app/kw.py:40        KwExtractPayload — ZAMKNIĘTA lista pól (brak osób, F-9)
   *   apps/worker/app/kw.py:64        EXTRACTION_PROMPT — polecenie pomijania osób fizycznych
   *   apps/worker/app/kw.py:92        verify_token — HMAC, porównanie o stałym czasie
   *   apps/worker/app/main.py:344     thinking disabled
   *   apps/worker/app/main.py:380     415 — tylko application/pdf
   *   apps/worker/app/main.py:383     413 — przekroczony limit rozmiaru
   *   apps/worker/app/main.py:394     bajty pliku nigdy nie są zapisywane ani logowane
   *   apps/worker/app/main.py:396     422 — docType "nieznany"
   *   apps/worker/app/main.py:404     akt bez KW lokalu -> wariant deweloperski
   *   apps/web/src/app/valuations/new/subject-form.tsx:307,313  bramka PDF + 32 MB w przeglądarce
   *   apps/web/src/app/actions/mint-kw-token.ts:7  TOKEN_TTL_SECONDS = 300
   *   apps/web/src/lib/assign-provenance.ts:26     powierzchnia to_verify TYLKO przy dokładnej równości
   *   apps/web/src/domain/kw-snapshot.ts:38        wpisy NIE są przestawiane na false
   *   apps/web/src/domain/document-model.ts:333    udzial_kw — kreska zamiast adnotacji
   */
  {
    slug: "ekstrakcja-kw-akt",
    title: "Ekstrakcja z odpisu KW i aktu notarialnego",
    tree: "metodyka",
    order: 4,
    tags: [
      "KW",
      "księga wieczysta",
      "odpis KW",
      "akt notarialny",
      "ekstrakcja",
      "odczyt dokumentu",
      "PDF",
      "32 MB",
      "dane osobowe",
      "PESEL",
      "RODO",
      "maskowanie",
      "dział III",
      "dział IV",
      "udział",
      "do potwierdzenia",
    ],
    summary:
      "Jakie dokumenty czytamy, co z nich bierzemy, czego świadomie nie bierzemy i dlaczego wynik zawsze wymaga potwierdzenia.",
    load: () => import("./metodyka/ekstrakcja-kw-akt.mdx"),
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
