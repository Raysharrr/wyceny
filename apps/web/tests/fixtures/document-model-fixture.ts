import { computeKcs, type KcsInput } from "../../src/domain/kcs";
import type { BuildDocumentInput } from "../../src/domain/document-model";
import type { SubjectSnapshot } from "../../src/domain/subject-snapshot";
import type { KwSnapshot } from "../../src/domain/kw-snapshot";

/**
 * Shared synthetic render-input fixture (F-12 completeness suite +
 * F-7 signature render tests, Slice 8). Golden KCS inputs — 12 comparables,
 * 3 rated features with scale definitions — never the source Kościelna
 * operat's real data.
 */
export function goldenInputs(subject?: SubjectSnapshot, kw?: KwSnapshot): KcsInput {
  return {
    area: 48.2,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 50,
      date: `2025-0${(i % 9) + 1}-15`,
      area: 40 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [
      {
        name: "standard wykończenia",
        weight: 0.4,
        rating: "przecietna" as const,
        key: "standard-wykonczenia",
        definitions: {
          lepsza: "wykończenie materiałami wyższej klasy",
          przecietna: "wykończenie w dobrym stanie",
        },
      },
      {
        name: "położenie na piętrze",
        weight: 0.3,
        rating: "lepsza" as const,
        key: "polozenie-na-pietrze",
        definitions: {
          lepsza: "czwarte piętro i powyżej",
          przecietna: "piętra pośrednie",
          gorsza: "parter",
        },
      },
      {
        name: "lokalizacja",
        weight: 0.3,
        rating: "gorsza" as const,
        key: "lokalizacja",
        definitions: { lepsza: "bliskość punktów usługowych" },
      },
    ],
    sampleMeta: null,
    provenance: null,
    subject,
    kw,
  };
}

/**
 * KW snapshot, standard variant — short synthetic KW numbers (F-9: not the
 * real 8-digit-middle shape). Two dzial3/dzial4 entries each (pins the
 * multi-entry loop-shaping fix, not just the single-entry case).
 */
export const KW_STANDARD: KwSnapshot = {
  source: "odpis_kw",
  kwLokalu: "PO1P/1/6",
  kwGruntu: "PO1P/2/4",
  kwInne: [],
  deweloperski: false,
  powUzytkowaKw: 50.55,
  udzial: "1/1",
  sad: "Sąd Rejonowy Poznań-Stare Miasto",
  wydzial: "V Wydział Ksiąg Wieczystych",
  dataDokumentu: "2026-06-01",
  dzial3: {
    wpisy: true,
    tresc: ["Ostrzeżenie o toczącym się postępowaniu", "Wzmianka o wniosku"],
  },
  dzial4: {
    wpisy: true,
    tresc: ["Hipoteka umowna na rzecz banku X", "Hipoteka przymusowa na rzecz US"],
  },
};

/** Developer variant — no own kwLokalu, examination covers the grunt KW only. */
export const KW_DEWELOPERSKI: KwSnapshot = {
  ...KW_STANDARD,
  kwLokalu: null,
  deweloperski: true,
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
};

/**
 * Akt notarialny — the source document never examines dział III/IV at all
 * (`dzial3`/`dzial4` are null, not "examined and empty"). Rendering "brak
 * wpisów" here would fabricate a clean-title/no-mortgage claim; the model
 * must render neither the brak sentence nor the wpisy loop for either dział.
 */
export const KW_AKT_NO_DZIAL: KwSnapshot = {
  ...KW_STANDARD,
  source: "akt",
  dzial3: null,
  dzial4: null,
};

/**
 * Akt notarialny whose extract carries NO udział (`udzial: null`). Because a KW
 * WAS examined (kw != null), the document must render a dash — never the legacy
 * "wg odpisu księgi wieczystej" annotation, which is reserved for pre-Slice-6
 * rows that never examined a KW (kw == null).
 */
export const KW_AKT_NULL_UDZIAL: KwSnapshot = {
  ...KW_STANDARD,
  source: "akt",
  udzial: null,
};

/** Subject snapshot with a resolved MPZP — drives the `{#mpzp}` section-9 variant. */
export const SUBJECT_WITH_MPZP: SubjectSnapshot = {
  obreb: "Jeżyce",
  arkusz: "10",
  nrDzialki: "161",
  powEwidHa: 0.0772,
  uzytek: "B",
  budynekRodzaj: "budynki mieszkalne",
  kondygnacjeNadziemne: 6,
  kondygnacjePodziemne: 1,
  mpzpAbsent: false,
  mpzpSymbol: "1MW/U",
  mpzpNazwa: "Plan Testowy",
  mpzpUchwala: "I/1/2020",
  mpzpData: "2020-01-01",
  mpzpPubl: "Rocznik 2020, poz. 1",
};

/** Subject snapshot with no MPZP — drives the `{#mpzp_brak}` section-9 variant. */
export const SUBJECT_NO_MPZP: SubjectSnapshot = {
  obreb: "Łazarz",
  mpzpAbsent: true,
  przeznaczenieStudium: "zabudowa (studium)",
};

/**
 * Complete `buildDocumentModel()` input — the shared baseline for the F-12
 * render-completeness suite and the F-7 signature render tests. No subject
 * and no kw (both optional and undefined by default) reproduces the legacy
 * "pre-slice, nothing fetched yet" scenario byte-for-byte.
 */
export function syntheticDocumentInput(
  subject?: SubjectSnapshot,
  kw?: KwSnapshot,
): BuildDocumentInput {
  const inputs = goldenInputs(subject, kw);
  return {
    address: "ul. Przykładowa 5, Poznań",
    area: 48.2,
    purpose: "informacyjny",
    kwNumber: "KW-TEST-9",
    client: "p. Anna Przykładowa",
    inspectionDate: "2026-06-30",
    approvedAt: new Date("2026-07-15T09:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
  };
}
