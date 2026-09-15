import type { ProvenanceSource } from "@wyceny/shared";
import { computeKcs, type Feature, type KcsInput } from "../../src/domain/kcs";
import type { BuildDocumentInput } from "../../src/domain/document-model";
import type { KwSnapshot } from "../../src/domain/kw-snapshot";
import type { Candidate } from "../../src/domain/sample-selection";
import { FEATURE_PRESETS, powierzchniaDefinitions } from "../../src/domain/feature-presets";
import { buildPhotoKey } from "../../src/domain/inspection";
import { currentSectionFactsHash } from "../../src/domain/prose-hash";
import {
  PROSE_SECTIONS,
  type ProseSection,
  type ProseSnapshot,
} from "../../src/domain/prose-snapshot";

/**
 * Fikstura zanonimizowana w kształcie wyceny lokalu z 14.09 (plan operat-bugfix §P1.4
 * TF.2, spec §7.2). WARTOŚCI SĄ FIKCYJNE — adres, KW, ulice transakcji, ceny, treść
 * działów i proza nie pochodzą z żadnego operatu ani raportu. Z wyceny 14.09 wzięty jest
 * tylko KSZTAŁT: cechy i wagi presetu z kroku 4, skale ocen z błędami P5, próba z remisem
 * Cmin, proza gotowa w `inputs.prose` (bez LLM).
 *
 * Przypadki paczki 1:
 * - lokalizacja: opisane lepsza/przeciętna, ocena „przeciętna” (ADR-016: niższy z dwóch → Ui min);
 * - powierzchnia `jak_zgloszono`: opisane lepsza/gorsza, ocena „przeciętna” na nieopisanym
 *   poziomie (po ADR-016 `ratingPosition = null` → brak WR); `poprawiona`: trzy opisane
 *   poziomy jak u Anety, ocena „przeciętna” — jedyny wariant, na którym WR istnieje;
 * - piętro ({@link PIETRO_PRZEDMIOTU}) i powierzchnia przedmiotu (44,2 m²);
 * - 12 transakcji z piętrem, powierzchnią i ulicą, dwie o tej samej najniższej cenie;
 * - `kw: "brak"` → `inputs.kw = null` + numer wpisany ręcznie; `odpis_z_wpisem_dzial_iii`
 *   → snapshot z uploadu odpisu z wpisem w dziale III;
 * - kategoria zdjęć „wnętrza” bez zdjęcia.
 *
 * ΣUi wariantu `poprawiona` (Cśr 10 362,29; Vmin 0,878; Vmax 1,146; pow. 44,2 m²). Reguła
 * ustalona 15.09 (koordynator): Ui zaokrąglany do 3 miejsc w każdym wierszu, ΣUi = suma
 * zaokrąglonych wierszy, jak u Anety — zmianę w `kcs.ts` robi FS.1 (`b1-feature-scales`).
 * - dziś (przeciętna → Ui śr; tyle samo w `jak_zgloszono`): 0,400 + 0,344 + 0,100 + 0,100 +
 *   0,035 + 0,053 = 1,032 → WR 472 700 zł (obie reguły dają to samo);
 * - po ADR-016 (lokalizacja → Ui min 0,088): wiersze 1,020 → WR 467 200 zł =
 *   {@link OCZEKIWANE_PO_ADR016}. Dopóki FS.1 nie jest w gałęzi integracyjnej, silnik zaokrąga
 *   dopiero sumę (0,4 + 0,3438 + 0,0878 + 0,1 + 0,03512 + 0,05268 = 1,0194) i daje
 *   1,019 → WR 466 700 zł.
 * Ceny dobrane tak, żeby rozjazd był taki jak na danych 14.09 (dziś zgodnie, po ADR-016
 * różnica 0,001: tam 1,021 / 466 800 w silniku wobec 1,022 / 467 300 u Anety), a żaden Ui
 * nie leżał na połówce trzeciego miejsca — wynik nie zależy od błędów zmiennoprzecinkowych.
 *
 * Pola nowych kontraktów paczki 1 (`subject.pietro`, `ekw_reczne`, `kwGrunt`,
 * `encumbranceTreatment`, progi `measure`, profil autora) dopisują sesje-właściciele.
 */

/**
 * Fikcyjny numer KW z HANDOFF-u. Składany w runtime, bo dosłowny ciąg w kształcie KW w
 * pliku śledzonym przez git zatrzymuje F-9 (`scripts/check-no-pii.sh`).
 */
export const KW_TESTOWA = ["XX1X", "00000000", "0"].join("/");

/** Piętro przedmiotu. Do czasu pola `subject.pietro` (P1.1, `b1-feature-hints`) stała obok fikstury. */
export const PIETRO_PRZEDMIOTU = 6;

/**
 * Oczekiwany wynik wariantu `poprawiona` po ADR-016 wg reguły „Ui per wiersz” (komentarz
 * modułu). Asercję na silniku pisze FS.1; do jej merge'u silnik daje 1,019 / 466 700.
 */
export const OCZEKIWANE_PO_ADR016 = { sumUi: 1.02, wr: 467_200 } as const;

const AREA = 44.2;
const ADDRESS = "ul. Testowa 7/12, Poznań";
const VALUATION_ID = "00000000-0000-4000-8000-000000001409";

export type Wariant1409 = {
  skalaPowierzchni?: "jak_zgloszono" | "poprawiona";
  kw?: "brak" | "odpis_z_wpisem_dzial_iii";
};

/** [cena zł/m², powierzchnia m², piętro, ulica, data] — pierwsze dwie to remis Cmin. */
const TRANSACTIONS: Array<[number, number, number, string, string]> = [
  [9100.0, 48.6, 10, "os. Testowe", "2025-10-14"],
  [9100.0, 47.9, 5, "ul. Przykładowa", "2025-11-03"],
  [9650.5, 38.4, 2, "os. Testowe", "2025-11-27"],
  [9820.0, 44.1, 7, "ul. Fikcyjna", "2025-12-09"],
  [10050.25, 52.3, 0, "os. Testowe", "2026-01-15"],
  [10240.0, 36.8, 3, "ul. Przykładowa", "2026-02-02"],
  [10400.75, 45.0, 9, "os. Testowe", "2026-03-11"],
  [10615.0, 41.2, 4, "ul. Fikcyjna", "2026-04-08"],
  [10880.4, 50.1, 1, "os. Testowe", "2026-05-20"],
  [11120.0, 39.7, 6, "ul. Przykładowa", "2026-06-16"],
  [11490.6, 43.5, 8, "ul. Fikcyjna", "2026-07-07"],
  [11880.0, 35.9, 3, "os. Testowe", "2026-08-12"],
];

const PROPOSED: Candidate[] = TRANSACTIONS.map(([pricePerM2, area, floor, street, date], i) => ({
  transactionId: `TEST-TX-${String(i + 1).padStart(2, "0")}`,
  date,
  area,
  pricePerM2,
  priceTotal: Math.round(area * pricePerM2 * 100) / 100,
  egib: null,
  lokalId: `TEST-LOK-${String(i + 1).padStart(2, "0")}`,
  distanceM: 80 + i * 35,
  floor,
  rooms: 2,
  market: i % 2 === 0 ? "wtorny" : null,
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: "osobaFizyczna",
  pos: null,
  street,
  streetNumber: String(i + 1),
  city: "Poznań",
}));

const preset = (key: string) => FEATURE_PRESETS.lokal.find((e) => e.key === key)!;

function features(skala: NonNullable<Wariant1409["skalaPowierzchni"]>): Feature[] {
  const fromPreset = (key: string, weight: number, rating: Feature["rating"]): Feature => ({
    name: preset(key).name,
    weight,
    rating,
    key,
    definitions: { ...preset(key).defaultDefinitions },
  });
  return [
    fromPreset("standard-wykonczenia", 0.4, "przecietna"),
    fromPreset("polozenie-na-pietrze", 0.3, "lepsza"),
    fromPreset("lokalizacja", 0.1, "przecietna"),
    {
      name: preset("powierzchnia-uzytkowa").name,
      weight: 0.1,
      rating: "przecietna",
      key: "powierzchnia-uzytkowa",
      // Jak zgłoszono: dwa poziomy z mediany próby (44 m²), jak liczy program.
      definitions:
        skala === "jak_zgloszono"
          ? powierzchniaDefinitions(44)
          : {
              lepsza: "powierzchnia użytkowa do 40 m²",
              przecietna: "powierzchnia użytkowa powyżej 40 m² do 46 m²",
              gorsza: "powierzchnia użytkowa powyżej 46 m²",
            },
    },
    fromPreset("pomieszczenia-przynalezne", 0.04, "gorsza"),
    fromPreset("dodatkowe", 0.06, "gorsza"),
  ];
}

const KW_ODPIS: KwSnapshot = {
  source: "odpis_kw",
  kwLokalu: KW_TESTOWA,
  kwGruntu: ["XX1X", "00000001", "0"].join("/"),
  kwInne: [],
  deweloperski: false,
  powUzytkowaKw: AREA,
  udzial: "442/10000",
  sad: "Sąd Rejonowy w Testowie",
  wydzial: "I Wydział Ksiąg Wieczystych",
  dataDokumentu: "2026-09-01",
  dzial3: {
    wpisy: true,
    tresc: ["Służebność osobista mieszkania na rzecz osoby fizycznej (wpis fikcyjny)."],
  },
  dzial4: { wpisy: false, tresc: [] },
};

const PROSE_TEXT: Record<ProseSection, string> = {
  analiza_rynku:
    "Analizą objęto rynek lokali mieszkalnych w budynkach wielorodzinnych w bezpośrednim sąsiedztwie przedmiotu wyceny. Dane fikcyjne.",
  opis_lokalu:
    "Lokal składa się z dwóch pokoi, kuchni, łazienki i przedpokoju; układ funkcjonalny jest typowy dla budynku.",
  otoczenie:
    "otoczenie stanowi zabudowa mieszkaniowa wielorodzinna z terenami zielonymi i punktami usługowymi.",
  zagospodarowanie: "teren wokół budynku jest utwardzony, z miejscami postojowymi i zielenią.",
  standard:
    "Standard wykończenia przeciętny, widoczne zużycie elementów wykończenia, lokal nadaje się do zamieszkania.",
  uzasadnienie:
    "Wynik mieści się w przedziale cen transakcyjnych próby i odpowiada cechom przedmiotu wyceny.",
};

function prose(inputs: KcsInput): ProseSnapshot {
  // Odciski liczone z danych tej wyceny — proza czyta się jako aktualna (bramka F-4).
  // `inputs.prose` nie wchodzi do odcisku, więc liczenie przed dołączeniem prozy jest właściwe.
  return {
    sections: Object.fromEntries(
      PROSE_SECTIONS.map((s) => [
        s,
        { value: PROSE_TEXT[s], provenance: { source: "rzeczoznawca", status: "confirmed" } },
      ]),
    ),
    rejected: {},
    factsHashes: Object.fromEntries(
      PROSE_SECTIONS.map((s) => [s, currentSectionFactsHash(s, { address: ADDRESS, inputs })]),
    ),
    model: "test-model",
    generatedAt: "2026-09-12T10:00:00.000Z",
  };
}

const CONFIRMED = (source: ProvenanceSource) => ({
  source,
  status: "confirmed" as const,
});

/** Wycena gotowa do kroku 7 — `BuildDocumentInput`, jak `syntheticDocumentInput()`. */
export function wycena1409Anon(wariant: Wariant1409 = {}): BuildDocumentInput {
  const { skalaPowierzchni = "jak_zgloszono", kw = "brak" } = wariant;
  const kwSnapshot = kw === "brak" ? null : KW_ODPIS;
  const base: KcsInput = {
    area: AREA,
    comparables: PROPOSED.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn",
      transactionId: c.transactionId,
      lokalId: c.lokalId,
      status: "confirmed",
    })),
    features: features(skalaPowierzchni),
    sampleMeta: {
      point: { x: 360000, y: 505000, source: "subject" },
      maxRadiusM: 3000,
      counts: { fetched: 60, deduped: 60, noPos: 0 },
      fetchedAt: "2026-09-10T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: {
        bbox: [359000, 504000, 361000, 506000],
        count: 5000,
        sort: "dok_data D",
        pages: 1,
        truncated: false,
      },
    },
    sampleSelection: {
      version: 3,
      proposed: PROPOSED,
      alternates: [],
      flags: {},
      rejectedCounts: { out_of_window: 15, manual_area_range: 9, manual_price_range: 4 },
      radiusUsedM: 500,
      radiusWalk: [{ radiusM: 500, inRadius: 40, afterHygiene: 25, afterBand: 12 }],
      counts: { pool: 60, inRadius: 40, afterHygiene: 25, afterBand: 12, proposed: 12 },
      params: {
        subjectArea: AREA,
        todayMonth: "2026-09",
        radiusOverrideM: 500,
        areaRange: { min: 35, max: 55 },
        unitPriceRange: { min: 9000, max: 12000 },
      },
    },
    provenance: {
      address: CONFIRMED("rzeczoznawca"),
      area: CONFIRMED("rzeczoznawca"),
      weights: CONFIRMED("rzeczoznawca"),
      ratings: CONFIRMED("rzeczoznawca"),
      featureDefs: CONFIRMED("preset"),
      geocode: CONFIRMED("geokoder"),
      ewidencja: CONFIRMED("ewidencja"),
      mpzp: CONFIRMED("mpzp"),
      ...(kwSnapshot ? { kw: CONFIRMED("odpis_kw") } : {}),
    },
    subject: {
      obreb: "Testowo",
      arkusz: "1",
      nrDzialki: "1/1",
      powEwidHa: 0.5,
      uzytek: "B",
      budynekRodzaj: "budynki mieszkalne",
      kondygnacjeNadziemne: 11,
      kondygnacjePodziemne: 1,
      rokBudowy: 1980,
      mpzpAbsent: true,
      przeznaczenieStudium: "teren zabudowy mieszkaniowej wielorodzinnej (dane fikcyjne)",
    },
    subjectMeta: {
      x: 360000,
      y: 505000,
      teryt: "0000000",
      fetchedAt: "2026-09-10T08:55:00.000Z",
      source: "test",
      mpzpAbsent: true,
    },
    kw: kwSnapshot,
    kwMeta: kwSnapshot
      ? {
          model: "test-model",
          extractedAt: "2026-09-10T08:58:00.000Z",
          docTypeDetected: "odpis_kw",
          docTypeDeclared: "odpis_kw",
        }
      : null,
    hasBasement: false,
    inspection: {
      note: "Lokal w stanie przeciętnym, widoczne zużycie elementów wykończenia.",
      photos: {
        otoczenie: [
          buildPhotoKey("otoczenie", "00000000-0000-4000-8000-00000000f001", VALUATION_ID),
        ],
        budynekZewn: [
          buildPhotoKey("budynekZewn", "00000000-0000-4000-8000-00000000f002", VALUATION_ID),
          buildPhotoKey("budynekZewn", "00000000-0000-4000-8000-00000000f003", VALUATION_ID),
        ],
        wnetrza: [],
      },
    },
  };
  const inputs: KcsInput = { ...base, prose: prose(base) };
  return {
    address: ADDRESS,
    area: AREA,
    purpose: "sprzedaz",
    kwNumber: KW_TESTOWA,
    propertyRight: "wlasnosc_lokalu",
    client: "Jan Fikcyjny",
    inspectionDate: "2026-09-10",
    approvedAt: new Date("2026-09-14T09:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "czterysta siedemdziesiąt dwa tysiące siedemset złotych",
  };
}

/**
 * Projekcja na wartości formularza (`valuationFormSchema`) — jawna, bo schemat nie zna
 * m.in. `prose`, `inspection` i `provenance`, a nieznane klucze obcina po cichu.
 */
export function formValuesOf(v: BuildDocumentInput) {
  const { inputs } = v;
  return {
    address: v.address,
    area: v.area,
    // Bez `status` — status nadaje ACL przy zapisie szkicu, formularz go nie niesie.
    comparables: inputs.comparables.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: c.source,
      transactionId: c.transactionId,
      lokalId: c.lokalId,
    })),
    features: inputs.features.map((f) => ({
      key: f.key,
      name: f.name,
      weightPct: Math.round(f.weight * 10000) / 100,
      rating: f.rating,
      definitions: f.definitions ?? undefined,
    })),
    sampleMeta: inputs.sampleMeta ?? undefined,
    sampleSelection: inputs.sampleSelection ?? undefined,
    subject: inputs.subject ?? undefined,
    subjectMeta: inputs.subjectMeta ?? undefined,
    // `kwSchema.optional()` nie przyjmuje `null` — brak KW to brak pola.
    kw: inputs.kw ?? undefined,
    kwMeta: inputs.kwMeta ?? undefined,
    purpose: v.purpose,
    propertyRight: v.propertyRight,
    hasBasement: inputs.hasBasement ?? false,
    kwNumber: v.kwNumber ?? undefined,
    client: v.client,
    inspectionDate: v.inspectionDate,
  };
}
