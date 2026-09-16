import { computeKcs, type KcsInput } from "../../src/domain/kcs";
import type { BuildDocumentInput, OperatAuthor } from "../../src/domain/document-model";
import type { AppraiserProfile } from "../../src/ports/profile";
import type { SubjectSnapshot } from "../../src/domain/subject-snapshot";
import type { KwGruntSnapshot, KwSnapshot } from "../../src/domain/kw-snapshot";

/**
 * Shared synthetic render-input fixture (F-12 completeness suite +
 * F-7 signature render tests, Slice 8). Golden KCS inputs — 12 comparables,
 * 3 rated features with scale definitions — never the source Kościelna
 * operat's real data.
 */
export function goldenInputs(
  subject?: SubjectSnapshot,
  kw?: KwSnapshot,
  kwGrunt?: KwGruntSnapshot,
): KcsInput {
  const inputs: KcsInput = {
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
    kwGrunt,
  };
  // Bezargumentowo ta fabryka była czysta — i to była prawda tylko dla jednego
  // z jej wywołań. Z argumentami wkłada do wyniku obiekty WOŁAJĄCEGO, którymi
  // są stałe modułowe (`SUBJECT_WITH_MPZP`, `KW_STANDARD`), więc zapis do
  // `subject`/`kw` wracał do stałej. Fabryka z parametrami jest tyloma
  // fabrykami, ile ma sensownych zestawów argumentów — bramka przemiatu bada
  // je osobno.
  return structuredClone(inputs);
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
  /**
   * Since b1-kw-read the §8.2 block asks `kwRequirements`, not `kw != null` —
   * so a fixture that stands for AN EXAMINED BOOK has to carry the day it was
   * examined. Without it this snapshot describes a book nobody opened, which is
   * exactly what the 14.09 operat did and what the new predicate refuses.
   */
  dataBadania: "2026-06-05",
};

/**
 * The mother book, examined — the developer variant's whole legal picture (a
 * lokal bought from a developer has no book of its own, so `kwRequirements`
 * counts only this one).
 */
export const KW_GRUNT_ZBADANA: KwGruntSnapshot = {
  source: "ekw_reczne",
  nrKsiegi: "PO1P/2/4",
  dataBadania: "2026-06-05",
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
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

/**
 * Subject snapshot with a resolved MPZP — drives the `{#prz_mpzp}` section-9
 * variant. All five designation parts are filled (M-10): `isPrzeznaczenieComplete`
 * gates both B-02 and §9, so an incomplete fixture would print nothing at all.
 */
export const SUBJECT_WITH_MPZP: SubjectSnapshot = {
  obreb: "Jeżyce",
  arkusz: "10",
  nrDzialki: "161",
  powEwidHa: 0.0772,
  uzytek: "B",
  budynekRodzaj: "budynki mieszkalne",
  kondygnacjeNadziemne: 6,
  kondygnacjePodziemne: 1,
  przeznaczenieRodzaj: "mpzp",
  przeznaczenieSymbol: "1MW/U",
  przeznaczenieNazwa: "Plan Testowy",
  przeznaczenieUchwala: "I/1/2020",
  przeznaczenieData: "2020-01-01",
  // Carried over from the pre-M-10 `mpzpPubl`. Inert on this branch —
  // `ma_publikator` is true only for `plan_ogolny` — but kept so the field
  // stays exercised by at least one fixture.
  przeznaczeniePublikator: "Rocznik 2020, poz. 1",
};

/**
 * Subject snapshot with no MPZP — the gmina still reads its studium (M-10),
 * which drives the `{#prz_brak_mpzp}` / `{#prz_studium}` section-9 variant.
 * Pre-M-10 this was `mpzpAbsent: true` + a free-text `przeznaczenieStudium`;
 * the studium now names its own resolution like any other source, so all five
 * parts are filled here too (fictional, F-9).
 */
export const SUBJECT_NO_MPZP: SubjectSnapshot = {
  obreb: "Łazarz",
  przeznaczenieRodzaj: "studium",
  przeznaczenieNazwa: "Gminy Testowej",
  przeznaczenieUchwala: "Nr II/2/2015 Rady Gminy Testowej",
  przeznaczenieData: "2015-02-02",
  przeznaczenieSymbol: "MN – zabudowa (studium)",
};

/**
 * Autor operatu dla testów — dane CAŁKOWICIE FIKCYJNE (F-9, ryzyko R10 specu):
 * nazwisko, numer uprawnień i adres biura nie należą do nikogo. Jedna stała dla
 * całego zestawu testów, żeby zmiana kształtu `OperatAuthor` miała jedno miejsce.
 */
export const AUTOR_TESTOWY: OperatAuthor = {
  fullName: "Jan Testowy",
  licenseNo: "0000",
  officeBlock: "Biuro Wycen Testowe\nul. Przykładowa 1\n60-000 Poznań",
  policyPages: [],
};

/**
 * Ten sam autor jako wiersz profilu — kompletny, z polisą ważną tak długo, że
 * upływ czasu nie zazieleni ani nie zaczerwieni żadnego testu (bramka porównuje
 * `insuranceValidUntil` z DZISIEJSZĄ datą, więc realistyczny rok wygasłby).
 */
export const PROFIL_TESTOWY: AppraiserProfile = {
  fullName: AUTOR_TESTOWY.fullName,
  licenseNo: AUTOR_TESTOWY.licenseNo,
  officeBlock: AUTOR_TESTOWY.officeBlock,
  insuranceDocKey: "polisa/test-user/fikcyjna",
  insuranceValidUntil: "2099-12-31",
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
  kwGrunt?: KwGruntSnapshot,
): BuildDocumentInput {
  const inputs = goldenInputs(subject, kw, kwGrunt);
  const v: BuildDocumentInput = {
    address: "ul. Przykładowa 5, Poznań",
    area: 48.2,
    purpose: "informacyjny",
    kwNumber: "KW-TEST-9",
    propertyRight: "wlasnosc_lokalu" as const,
    client: "p. Anna Przykładowa",
    inspectionDate: "2026-06-30",
    approvedAt: new Date("2026-07-15T09:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
    author: AUTOR_TESTOWY,
  };
  // Bez klonu `author` byłby tym samym obiektem co stała `AUTOR_TESTOWY` we
  // wszystkich wywołaniach (`goldenInputs` jest czyste, więc to jedyny
  // przeciek tej fabryki). Pilnuje tego `fixtures-isolation.test.ts`.
  return structuredClone(v);
}
