/**
 * Pułapka z b1-kw-read: pole opcjonalne pominięte w funkcji mapującej nie daje
 * błędu kompilacji, tylko cichą utratę danych. `Required<>` zamyka to dla
 * TypeScriptu; ten test zamyka to dla zod (schemat obcina nieznane klucze po
 * cichu) i dla `normalizeKw*` — na całych migawkach, `toEqual`, nie polami.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { step1Schema } from "@/app/actions/wizard-schemas";
import {
  normalizeKw,
  normalizeKwGrunt,
  type KwGruntSnapshot,
  type KwSnapshot,
} from "@/domain/kw-snapshot";
import { ksiegaTrescMigawkiSchema, ksiegaTrescSchema } from "@/domain/kw-tresc";
import { planOdczytuKw, step1DefaultsFromInputs } from "@/lib/subject-form";

function ksiega() {
  const wire = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "..", "worker", "tests", "fixtures", "kw_transcribe_sample.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  delete wire.walidacja;
  return ksiegaTrescSchema.parse(wire);
}

/** Księga gruntu z `zakres` — schemat MIGAWKI, bo to on niesie zakres przez formularz (ADR-024). */
function ksiegaGruntu() {
  const wire = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "..",
        "worker",
        "tests",
        "fixtures",
        "kw_transcribe_grunt_sample.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  delete wire.walidacja;
  return ksiegaTrescMigawkiSchema.parse(wire);
}

const WERDYKT = {
  ok: false,
  bledy: [{ klasa: "kw_cyfra_kontrolna:kwGruntu" }, { klasa: "pesel_suma", dzial: "II" }],
  kanal: "tekst" as const,
  plikow: 0,
  at: "2026-09-21T10:00:00.000Z",
};

const KW: Required<KwSnapshot> = {
  source: "ekw_wklej",
  kwLokalu: "AB1C/1/9",
  kwGruntu: "AB1C/2/7",
  kwInne: [],
  deweloperski: false,
  powUzytkowaKw: null,
  udzial: "1/2",
  sad: "Sąd Rejonowy w Testowie",
  wydzial: "I Wydział Ksiąg Wieczystych",
  dataDokumentu: null,
  dzial3: { wpisy: true, tresc: ["Rubryka: wartość"] },
  dzial4: { wpisy: false, tresc: [] },
  dataBadania: "2026-09-21",
  nrLokalu: "24",
  akt: { rodzaj: "UMOWA SPRZEDAŻY", rep: "1/2018", data: "2018-06-21" },
  tresc: ksiega(),
  transkrypcja: WERDYKT,
};

const GRUNT: Required<KwGruntSnapshot> = {
  source: "odpis_kw",
  nrKsiegi: "AB1C/2/7",
  dataBadania: "2026-09-21",
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
  sad: "Sąd Rejonowy w Testowie",
  wydzial: "I Wydział Ksiąg Wieczystych",
  tresc: ksiegaGruntu(),
  transkrypcja: { ...WERDYKT, ok: true, bledy: [], kanal: "pdf", plikow: 3 },
  kluczeLokalu: { kwLokalu: "AB1C/1/9", nrLokalu: "24" },
};

function przezFormularz() {
  const defaults = step1DefaultsFromInputs({
    address: "ul. Testowa 1, Poznań",
    area: 44.23,
    purpose: "sprzedaz",
    propertyRight: "wlasnosc_lokalu",
    kwNumber: "AB1C/1/9",
    client: "Jan Testowy",
    inputs: { area: 44.23, comparables: [], features: [], kw: KW, kwGrunt: GRUNT },
  });
  return step1Schema.parse({ ...defaults, subject: undefined, subjectMeta: undefined });
}

describe("round-trip migawek KW: inputs → defaults → schema → normalize", () => {
  it("księga lokalu wraca w całości — z treścią i werdyktem", () => {
    const parsed = przezFormularz();
    expect(normalizeKw(parsed.kw!)).toEqual(KW);
  });

  it("księga gruntu wraca w całości — sąd, wydział, treść z zakresem, werdykt, klucze lokalu", () => {
    const parsed = przezFormularz();
    expect(GRUNT.tresc?.zakres).toBe("przedmiotowy_lokal");
    expect(normalizeKwGrunt(parsed.kwGrunt!)).toEqual(GRUNT);
  });

  it("stara migawka gruntu (5 pól) przechodzi i dostaje jawne null-e — bez migracji", () => {
    const stary: KwGruntSnapshot = {
      source: "ekw_reczne",
      nrKsiegi: "AB1C/2/7",
      dataBadania: "2026-09-15",
      dzial3: { wpisy: false, tresc: [] },
      dzial4: null,
    };
    const defaults = step1DefaultsFromInputs({
      address: "x",
      area: 1,
      purpose: "sprzedaz",
      propertyRight: "wlasnosc_lokalu",
      // Numer, nie `null`: `step1Schema` wymaga go dla własności lokalu, a ten
      // test bada migawkę gruntu — nie regułę o numerze (rozbieżność z planem).
      kwNumber: "AB1C/1/9",
      client: "y",
      inputs: { area: 1, comparables: [], features: [], kwGrunt: stary },
    });
    expect(defaults.kwGrunt).toEqual({
      ...stary,
      sad: null,
      wydzial: null,
      tresc: null,
      transkrypcja: null,
      kluczeLokalu: null,
    });
    expect(step1Schema.safeParse({ ...defaults, subject: undefined }).success).toBe(true);
  });
});

describe("F7: kanał tekstowy na ścieżce aktu nie jest odczytem", () => {
  const tekst = { kanal: "tekst" as const, tekst: "DZIAŁ I-O - OZNACZENIE" };
  const pdf = { kanal: "pdf" as const, files: [] as File[] };

  it("akt + tekst: nie ma czego odczytać ani przepisać, więc odczyt jest niedozwolony", () => {
    expect(planOdczytuKw(tekst, "lokal", "akt")).toEqual({
      akt: true,
      czytaPola: false,
      transcribes: false,
      dozwolony: false,
    });
  });

  it("akt + PDF czyta pola bez transkrypcji; pozostałe kombinacje przepisują treść", () => {
    expect(planOdczytuKw(pdf, "lokal", "akt")).toMatchObject({
      akt: true,
      czytaPola: true,
      transcribes: false,
      dozwolony: true,
    });
    expect(planOdczytuKw(tekst, "lokal", "ekw_wklej")).toMatchObject({
      akt: false,
      transcribes: true,
      dozwolony: true,
    });
    // Karta gruntu nie czyta pól przez /kw-extract — bierze je z nagłówka treści.
    // Karta gruntu nie zna ścieżki aktu — `akt` jest tam zawsze fałszem.
    expect(planOdczytuKw(pdf, "grunt", "akt")).toMatchObject({
      akt: false,
      czytaPola: false,
      transcribes: true,
      dozwolony: true,
    });
  });
});
