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
  /**
   * Uwaga dla utrzymujących treść: od Slice 3 `krok-3-proba.mdx` importuje
   * wprost `DEFAULTS` (`@/domain/sample-selection`), `REQUIRED_SAMPLE_SIZE`
   * (`@/domain/provenance`), `MANUAL_REJECTION_REASONS`/`_LABELS`
   * (`@/domain/sample-manual`), `REJECTED_PER_REASON`
   * (`@/domain/sample-snapshot`) i `STREET_VIEW_TTL_DAYS`
   * (`@/app/actions/_street-view-enrich`) — te liczby i etykiety rozjechać
   * się z kodem nie mogą. Reszta strony (etykiety przycisków, nazwy sekcji,
   * kolory kropek na mapie, kolejność zakładek podglądu, warunek zwinięcia
   * „Próby do kalkulacji") opisuje UI komponentów kroku 3 i importu nie ma —
   * trzeba ją porównać z kodem ręcznie przy każdej zmianie. Komentarz stoi w
   * manifeście, a nie w MDX, z powodu opisanego przy `dobor-proby-rcn` niżej.
   *
   * Źródła do sprawdzenia przy każdej zmianie kroku 3:
   *   apps/web/src/app/valuations/[id]/steps/sample-badges.ts        etykiety i warunki odznak (ten sam budynek / ta sama działka / inny obręb / p. N / >5 kond. / rynek? / prawdopodobnie deweloperska / cena odstająca)
   *   apps/web/src/app/valuations/[id]/steps/sample-sections.tsx     sekcje „W próbie (N)" / „Alternatywy (M)", stan zwinięcia
   *   apps/web/src/app/valuations/[id]/steps/sample-table.tsx        tabela wierszy jednej sekcji, miniaturki, checkbox „w próbie", kolumna ✓
   *   apps/web/src/app/valuations/[id]/steps/sample-panel.tsx        panel boczny: zakładki Ulica / Mapa / Ortofoto, „Zostaw", „Odrzuć"
   *   apps/web/src/app/valuations/[id]/steps/sample-rejected.tsx     sekcja „Odrzucone (N)", grupowanie po powodzie, „Przywróć"
   *   apps/web/src/app/valuations/[id]/steps/rejected-groups.ts      REJECT_REASON_LABELS — etykiety powodów higieny/pasma w sekcji „Odrzucone"
   *   apps/web/src/app/valuations/[id]/steps/sample-radius.tsx       przyciski promienia, stan disabled
   *   apps/web/src/app/valuations/[id]/steps/sample-map-leaflet.tsx  mapa przeglądowa (Leaflet): warstwy OSM / Ortofoto / EGiB, znacznik budynku + rozkładanie lokali, podpis pod mapą
   *   apps/web/src/app/valuations/[id]/steps/map-markers.ts          kolory i rodzaje kropek, etykiety „propozycja … · w próbie / alternatywa", „budynek: N propozycji…", promienie pierścieni
   *   apps/web/src/app/valuations/[id]/steps/step-sample.tsx         sekcja „Próba do kalkulacji", pasek liczników, komunikat o starym szkicu
   *   apps/web/src/domain/sample-manual.ts                           MANUAL_REJECTION_REASONS/LABELS (IMPORTOWANE do MDX), reguła promocji alternatywy
   *   apps/web/src/domain/sample-snapshot.ts:42                      REJECTED_PER_REASON = 50 (IMPORTOWANE do MDX)
   *   apps/web/src/domain/obreb-name.ts                               OBREBY_POZNAN, obrebLabel — format kolumny obręb
   *   apps/web/src/app/actions/_street-view-enrich.ts                 STREET_VIEW_TTL_DAYS (IMPORTOWANE do MDX), ENRICH_BUDGET_MS
   *   apps/web/src/adapters/street-view-google.ts                     Metadata -> Static 160×100, tylko współrzędna do Google
   *   apps/web/src/app/actions/_pool-cache.ts                         cache puli per wycena — podstawa przycisków promienia
   *   apps/web/src/app/actions/reselect-sample.ts                     przeliczenie po zmianie promienia bez ponownego zapytania RCN
   */
  {
    slug: "krok-3-proba",
    title: "Krok 3 — Próba porównawcza",
    tree: "jak-korzystac",
    order: 4,
    tags: [
      "próba",
      "transakcje",
      "RCN",
      "porównawcze",
      "zł/m²",
      "Cśr",
      "12 transakcji",
      "fasada",
      "Street View",
      "odrzuć",
      "powód odrzucenia",
      "promień",
      "alternatywy",
      "odrzucone",
      "mapa",
      "dodaj do próby",
      "przejrzane",
    ],
    summary:
      "Przegląd propozycji z RCN z podglądem budynku, odrzucanie z powodem, promień i odrzucone.",
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
    tags: [
      "opisy",
      "sekcje opisowe",
      "proza",
      "AI",
      "generowanie opisów",
      "do weryfikacji",
      "zatwierdzenie opisów",
      "uwagi z oględzin",
      "wygeneruj ponownie",
    ],
    summary:
      "Propozycje opisów powstają automatycznie z danych tej wyceny — przeczytaj, popraw i zatwierdź.",
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
   * Uwaga dla utrzymujących treść: od ADR-015 („Dobór próby v3”) ranking
   * podobieństwa i jego stałe żyją w czystej domenie TS
   * (`DEFAULTS`, `DEFAULT_WEIGHTS` w `@/domain/sample-selection`) —
   * `dobor-proby-rcn.mdx` i `krok-3-proba.mdx` importują je wprost, więc z
   * kodem rozjechać się nie mogą. Stałe workera (Python: paginacja rejestru,
   * promień zapytania) importu do MDX nie mają i strona przepisuje je
   * ręcznie. Od Slice 3 strona importuje też `STREET_VIEW_TTL_DAYS`
   * (`@/app/actions/_street-view-enrich`) i `OBREBY_POZNAN`
   * (`@/domain/obreb-name`) — mechanika Street View (Metadata → Static,
   * kadrowanie kamery) i format etykiety obrębu importu nie mają i strona
   * opisuje je z odczytu kodu. Komentarz stoi tutaj, a nie w samym MDX, bo
   * prettier formatuje `.mdx` markdownowo i przerabia `{/* … *\/}` na
   * `{/_ … _/}` — plik przestaje się kompilować, a CI (`pnpm format:check`)
   * i tak wywala różnicę.
   *
   * Źródła do sprawdzenia przy każdej zmianie doboru:
   *   apps/web/src/domain/sample-selection.ts:93  DEFAULT_WEIGHTS (wagi rankingu, importowane wprost do MDX)
   *   apps/web/src/domain/sample-selection.ts:100 DEFAULTS (promień, okno, pasmo metrażu, IQR, importowane wprost do MDX)
   *   apps/worker/app/rcn.py:22   DATE_WINDOW_MONTHS = 24
   *   apps/worker/app/rcn.py:23   PAGE_SIZE = 5000
   *   apps/worker/app/rcn.py:24   SORT_BY = "dok_data D,tran_lokalny_id_iip D"
   *   apps/worker/app/rcn.py:188  fetch_pool — paginacja aż do pokrycia okna albo max_pages
   *   apps/worker/app/main.py:181 DEFAULT_RADIUS_M = 3000.0 (promień zapytania do rejestru, ±3 km)
   *   apps/worker/app/main.py:187 resolve_point — kolejność geokoderów: punkt z kroku 1 → UUG (GUGiK) → Nominatim
   *   apps/web/src/app/actions/get-sample-proposal.ts:57 getSampleProposal — spina pulę z workera (fetchPool) z domeną (selectSample)
   *   apps/web/src/domain/sample-manual.ts                MANUAL_REJECTION_REASONS — słownik powodów ręcznego odrzucenia
   *   apps/web/src/app/actions/_street-view-enrich.ts     STREET_VIEW_TTL_DAYS (IMPORTOWANE do MDX), ENRICH_BUDGET_MS, Metadata → Static, jedna miniaturka per budynek
   *   apps/web/src/adapters/street-view-google.ts         wywołania Google — do serwisu trafia wyłącznie współrzędna budynku
   *   apps/web/src/app/actions/_pool-cache.ts             pula cache'owana per wycena — podstawa przeliczenia promienia bez ponownego zapytania RCN
   *   apps/web/src/domain/obreb-name.ts                   OBREBY_POZNAN (IMPORTOWANE do MDX), obrebLabel/obrebName — format „numer nazwa" / „numer · gm. TERYT"
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
      "promień",
      "ranking podobieństwa",
      "obręb",
      "działka",
      "budynek",
      "pasmo metrażu",
      "okno czasowe",
      "odstające",
      "rynek pierwotny",
      "12 transakcji",
      "Street View",
      "Google",
      "miniaturka",
      "ręczne odrzucenie",
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
   *   apps/worker/app/subject.py:128  pick_mpzp_function — symbol przez MAX przecięcia
   *   apps/worker/app/subject.py:144  pick_plan — metryka planu przez punkt w wielokącie
   *   apps/worker/app/subject.py:162  COVERAGE_TERYT_PREFIX — JEDYNA definicja zasięgu (prefiks TERYT)
   *   apps/worker/app/subject.py:165  is_poznan — bramka zasięgu (dane przedmiotu, podpowiedzi, mapy)
   *   apps/worker/app/subject.py:189  AddressNotFound — adres nierozpoznany, NIEPONAWIALNY (422)
   *   apps/worker/app/subject.py:172  GEOKODER_URL (UUG GUGiK)
   *   apps/worker/app/subject.py:173  ULDK_URL (identyfikator + geometria działki)
   *   apps/worker/app/subject.py:174  GEOPOZ_WMS_URL (EGiB: dzialki, budynki)
   *   apps/worker/app/subject.py:175  GEOPOZ_WFS_URL (mpzp_poznan:mpzp_funkcje)
   *   apps/worker/app/subject.py:176  PLANS_URL (miejska warstwa metryk planów)
   *   apps/worker/app/subject.py:178  PLANS_CACHE_TTL_S = 3600 s
   *   apps/worker/app/subject.py:260  half = 50.0 — kwadrat zapytania GetFeatureInfo
   *   apps/worker/app/subject.py:275  FEATURE_COUNT = 10
   *   apps/worker/app/subject.py:227  count = 50 (limit obiektów WFS funkcji)
   *   apps/worker/app/subject.py:103  parcel_from_xml — lista pól EGiB działki
   *   apps/worker/app/subject.py:117  building_from_xml — lista pól EGiB budynku
   *   apps/worker/app/main.py:212     ADDRESS_NOT_FOUND_DETAIL — komunikat cytowany na stronach
   *   apps/worker/app/main.py:216     OUT_OF_COVERAGE_DETAIL — drugi z dwóch nieponawialnych 422
   *   apps/worker/app/main.py:239     mpzp niepuste, gdy zadziała funkcja LUB plan
   *   apps/worker/app/main.py:297     MAPS_OUT_OF_COVERAGE_DETAIL — ten sam kontrakt dla map
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
  /**
   * Uwaga dla utrzymujących treść: `zasady-zatwierdzania.mdx` importuje próg
   * `REQUIRED_SAMPLE_SIZE` oraz `PROSE_SECTIONS` (liczba sekcji opisowych) —
   * to jedyne dwie liczby na tej stronie. Wszystko pozostałe to reguły bez
   * liczb — opisane z odczytu kodu, więc przy każdej zmianie bramy trzeba
   * przejść listę poniżej. Komentarz stoi w manifeście, a nie w MDX, z powodu
   * opisanego przy `dobor-proby-rcn` powyżej.
   *
   * Źródła do sprawdzenia przy każdej zmianie zasad zatwierdzania:
   *   apps/web/src/domain/provenance.ts:8      REQUIRED_SAMPLE_SIZE (IMPORTOWANE do MDX)
   *   apps/web/src/domain/prose-snapshot.ts:17 PROSE_SECTIONS (IMPORTOWANE do MDX)
   *   apps/web/src/domain/provenance.ts:214    blokady prozy — brak migawki, odcisk, per sekcja
   *   apps/web/src/domain/provenance.ts:69     requireProse — wyłącznik zdejmuje CAŁĄ grupę prozy
   *   packages/shared/src/sourced.ts:20        źródło "ai" — pozycja zamkniętej listy
   *   apps/web/src/domain/provenance.ts:57     statusLabel — DWIE etykiety, w tym "brak prowenancji"
   *   apps/web/src/domain/provenance.ts:61     approvalGate — komplet blokad, zbierane wszystkie naraz
   *   apps/web/src/domain/provenance.ts:96     featureDefs gated TYLKO gdy migawka niesie klucz
   *   apps/web/src/domain/provenance.ts:107    geocode gated tylko przy sampleMeta
   *   apps/web/src/domain/provenance.ts:121    ewidencja + mpzp gated razem, przy subject
   *   apps/web/src/domain/provenance.ts:142    grupa kw gated tylko przy migawce kw
   *   apps/web/src/domain/provenance.ts:151    kwGruntu — warunek kompletności, nie statusu
   *   apps/web/src/domain/provenance.ts:157    kwLokalu — z wyjątkiem wariantu deweloperskiego
   *   packages/shared/src/sourced.ts:7         ZAMKNIĘTA lista źródeł prowenancji
   *   packages/shared/src/sourced.ts:33        isBlocking — blokuje wszystko poza "confirmed"
   *   apps/web/src/lib/assign-provenance.ts:18 statusy nadaje serwer (ADR-010)
   *   apps/web/src/lib/assign-provenance.ts:26 powierzchnia to_verify TYLKO przy dokładnej równości
   *   apps/web/src/lib/assign-provenance.ts:64 wykrycie zestawu cech po stronie serwera, próg z mediany
   *   apps/web/src/domain/document-model.ts:241 documentFieldBlockers — cztery pola + wr
   *   apps/web/src/domain/valuation.ts:246,279,296  każda edycja wejść silnika zeruje wr
   *   apps/web/src/domain/valuation.ts:251     grupy kroku 1 ZASTĘPOWANE, nie scalane
   *   apps/web/src/domain/valuation.ts:337     szkic bez migawki — jedna blokada "brak danych wejściowych"
   *   apps/web/src/app/actions/approve-valuation.ts:54  pierwszy przebieg bramy (szybka odmowa)
   *   apps/web/src/adapters/valuation-drizzle.ts:405    porównanie migawki (InputsChangedError)
   *   apps/web/src/adapters/valuation-drizzle.ts:411    DRUGI przebieg bramy, w transakcji
   *   apps/web/src/adapters/valuation-drizzle.ts:423    warunkowy UPDATE (status = in_progress)
   *   apps/web/tests/valuation-repo.test.ts:148         test "API bypass impossible" — cytowany na stronie
   */
  {
    slug: "zasady-zatwierdzania",
    title: "Zasady zatwierdzania i prowenancja danych",
    tree: "metodyka",
    order: 5,
    tags: [
      "prowenancja",
      "zatwierdzenie",
      "brama zatwierdzenia",
      "blokady",
      "potwierdzenia",
      "do weryfikacji",
      "brak prowenancji",
      "źródło danych",
      "ADR-010",
      "F-4",
      "domyślna odmowa",
      "wpis ręczny",
    ],
    summary:
      "Skąd wiadomo, kto odpowiada za każdą wartość w operacie, komplet warunków blokujących zatwierdzenie i dlaczego brama stoi po stronie serwera.",
    load: () => import("./metodyka/zasady-zatwierdzania.mdx"),
  },
  /**
   * Uwaga dla utrzymujących treść: `operat-i-niezmiennosc.mdx` importuje
   * `OPERAT_SECTIONS` i renderuje ich liczbę — nie wpisywać jej ręcznie.
   * Liczba sekcji zmienia się razem z szablonem, więc rzeczownik przy niej
   * odmienia `plural()` (dziś 23 → "numerowane sekcje", ale np. 25 →
   * "numerowanych sekcji"); nie zastępować tego wywołania stałym napisem.
   * Wyzwalacze bazy, algorytm sumy kontrolnej i sekwencja zatwierdzenia to
   * reguły bez liczb, opisane z odczytu kodu. Komentarz stoi w manifeście, a
   * nie w MDX, z powodu opisanego przy `dobor-proby-rcn` powyżej.
   *
   * UWAGA na trzy RÓŻNE zakresy niezmienności — strona rozdziela je celowo i
   * spłaszczenie ich do jednego zdania czyni ją nieprawdziwą:
   *   apps/web/drizzle/0009_f7_immutability_audit_sign.sql:22  RLS omijalne, wyzwalacze nie
   *   apps/web/drizzle/0009_f7_immutability_audit_sign.sql:29  valuation_write_once WHEN status='signed'
   *   apps/web/drizzle/0009_f7_immutability_audit_sign.sql:39  audit_log_append_only — BEZWARUNKOWY
   *   apps/web/drizzle/0009_f7_immutability_audit_sign.sql:47  document_frozen — tylko dokumenty podpisanej wyceny
   *
   * Źródła do sprawdzenia przy każdej zmianie operatu, audytu lub podpisu:
   *   apps/web/src/domain/operat-sections.ts:7          OPERAT_SECTIONS (IMPORTOWANE do MDX)
   *   apps/web/src/domain/document-model.ts:78          maskowanie: miesiąc zamiast pełnej daty (F-12)
   *   apps/web/src/domain/document-model.ts:277         mpzp / mpzp_brak — wzajemnie wykluczające się
   *   apps/web/src/domain/document-model.ts:285         cechy o wadze 0 poza dokumentem
   *   apps/web/src/domain/document-model.ts:545,546     Tabela 1 (Slice 3): obreb (obrebLabel) i odleglosc per wiersz, ręczne wiersze — kreska
   *   apps/web/src/domain/obreb-name.ts                 obrebLabel — format „numer nazwa" (Poznań) / „numer · gm. TERYT" (poza Poznaniem)
   *   apps/web/src/domain/document-model.ts:399,400     honest silence: skala ocen, uwagi z oględzin
   *   apps/web/src/app/actions/approve-valuation.ts:20  KOLEJNOŚĆ, nie transakcyjność
   *   apps/web/src/app/actions/approve-valuation.ts:50  odmowa PRZED generowaniem (nie nadpisz operatu)
   *   apps/web/src/app/actions/approve-valuation.ts:109 kasowanie osieroconych map przy "bez map"
   *   apps/web/src/app/actions/approve-valuation.ts:117 brak zdjęcia z manifestu = twardy błąd
   *   apps/web/src/app/actions/sign-valuation.ts:17     SHA-256 liczone przy podpisie
   *   apps/web/src/app/actions/sign-valuation.ts:41     podpisuje WYŁĄCZNIE właściciel (nie admin)
   *   apps/web/src/app/actions/sign-valuation.ts:69     data sporządzenia z approvedAt, nie z zegara
   *   apps/web/src/app/actions/sign-valuation.ts:84     mapy z magazynu, bez kontaktu z WMS
   *   apps/web/src/domain/valuation.ts:353              zamknięta lista akcji audytu (bez liczby na stronie)
   *   apps/web/src/domain/valuation.ts:400,412          reguła resetu: rcn / "rzeczoznawca"
   *   apps/web/src/domain/valuation.ts:420              newVersionOf — tylko z PODPISANEJ
   *   apps/web/src/adapters/valuation-drizzle.ts:426    wiersz "approved": docUrl/docxUrl, BEZ haszy
   *   apps/web/src/adapters/valuation-drizzle.ts:462    wiersz "signed": sha256Docx/sha256Pdf
   *   apps/web/src/app/valuations/[id]/page.tsx:128     jeden następca — pilnuje UI, nie serwer
   *   apps/web/tests/f12-document-sections.test.ts:20   komplet sekcji, brak "undefined", brak przecieku
   *   apps/web/tests/audit-log.test.ts:166              nieudana mutacja nie zostawia wiersza
   *
   * Sumy kontrolne NIE są nigdzie weryfikowane — strona mówi to wprost.
   * Sprawdzenie: `grep -rn "sha256" apps/web/src` (wyłącznie zapis i typy).
   */
  {
    slug: "operat-i-niezmiennosc",
    title: "Operat i niezmienność dokumentu",
    tree: "metodyka",
    order: 6,
    tags: [
      "operat",
      "niezmienność",
      "write-once",
      "suma kontrolna",
      "SHA-256",
      "dziennik audytu",
      "audit log",
      "podpis",
      "nowa wersja",
      "wersjonowanie",
      "maskowanie",
      "F-7",
      "F-12",
      "sekcje operatu",
    ],
    summary:
      "Z czego powstaje operat, co dzieje się przy zatwierdzeniu, co dokładnie zamraża podpis i co zapisuje dziennik audytu.",
    load: () => import("./metodyka/operat-i-niezmiennosc.mdx"),
  },
  /**
   * Uwaga dla utrzymujących treść (ograniczenie R1 ze specu):
   * `opisy-generowane.mdx` importuje `PROSE_SECTIONS` i `PROSE_SECTION_LABEL`
   * (`@/domain/prose-snapshot`) — jedyne web-autorytatywne stałe tej strony.
   * Cała mechanika generowania mieszka w workerze (Python), więc nazwa modelu,
   * limit długości odpowiedzi, próg trendu i liczba prób są opisane SŁOWEM, bez
   * cyfr udających kontrakt. Nie wpisywać ich liczbowo — strona przestałaby być
   * prawdziwa przy pierwszej zmianie w workerze, a nic by tego nie wykryło.
   * Komentarz stoi w manifeście, a nie w MDX, z powodu opisanego przy
   * `dobor-proby-rcn` powyżej.
   *
   * Źródła do sprawdzenia przy każdej zmianie generowania opisów:
   *   apps/worker/app/main.py:427        PROSE_MODEL — nazwa modelu (NIE cytować)
   *   apps/worker/app/main.py:435        PROSE_MAX_TOKENS — limit długości (NIE cytować)
   *   apps/worker/app/main.py:514        PROSE_RETRY_INSTRUCTION — dopisek do drugiej próby
   *   apps/worker/app/main.py:529        _prose_section — DOKŁADNIE jedna dodatkowa próba
   *   apps/worker/app/main.py:608        wstrzyknięcie proba.trend_cen do faktów
   *   apps/worker/app/main.py:640        sekcje liczone równolegle, awaria jednej nie psuje reszty
   *   apps/worker/app/main.py:657        502, gdy nie przeżyła ani jedna sekcja
   *   apps/worker/app/prose.py:82        price_trend — połowy próby, próg (NIE cytować)
   *   apps/worker/app/prose.py:121       _allowed_numbers — zbiór dozwolony: liczba + zapis z przecinkiem, BEZ części całkowitej
   *   apps/worker/app/prose.py:155       validate_numbers — DOSŁOWNE dopasowanie; wyjątki: jednostka i idiom „1 m2"
   *   apps/worker/app/prompts/prose/_style.md   styl i zakaz domyślania wątków
   *   apps/web/src/domain/prose-snapshot.ts:17  PROSE_SECTIONS (IMPORTOWANE do MDX)
   *   apps/web/src/domain/prose-snapshot.ts:34  PROSE_SECTION_LABEL (IMPORTOWANE do MDX)
   *   apps/web/src/domain/prose.ts:135          buildProseFacts — agregaty wszystko-albo-nic
   *   apps/web/src/domain/prose.ts:118          resultPosition — F-11, wyłącznie określenie słowne
   *   apps/web/src/domain/prose.ts:253          selectProseSections — które sekcje w ogóle zamawiamy
   *   apps/web/src/domain/prose-hash.ts:70      currentSectionFactsHash — odcisk per sekcja, próba sortowana
   *   apps/web/src/domain/provenance.ts:214     blokady prozy w bramie F-4
   */
  {
    slug: "opisy-generowane",
    title: "Opisy sekcji generowane z danych wyceny",
    tree: "metodyka",
    order: 7,
    tags: [
      "opisy",
      "proza",
      "AI",
      "model językowy",
      "generowanie",
      "kontrola liczb",
      "zmyślone liczby",
      "odrzucona sekcja",
      "trend cen",
      "fakty wyceny",
      "odcisk faktów",
      "ADR-014",
      "FR-6",
      "F-11",
    ],
    summary:
      "Co widzi model piszący opisy, jak sprawdzana jest każda liczba w jego tekście i czego ta kontrola nie łapie.",
    load: () => import("./metodyka/opisy-generowane.mdx"),
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
