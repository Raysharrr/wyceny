/**
 * R-10 (ADR-018 reg. 2): the "KW required" rule used to live in four copies —
 * the two step-1 schemas, the operat's document-field blockers and the F-4
 * gate. `kwRequirements` is now the one source.
 *
 * Two commits meet in this file. `f2aa2b2` moved the rule without changing it,
 * pinning what each of the four copies did — including the gap: the gate asked
 * for the KW gruntu only when a snapshot existed, so the manual path skipped
 * the requirement entirely. KE.4 closes that gap, and this file now records
 * the behaviour AFTER it; the divergence from that commit's table IS the fix.
 *
 * KW numbers below are short synthetic strings, never the real format (F-9).
 */
import { describe, expect, it } from "vitest";
import { step1Schema } from "../src/app/actions/wizard-schemas";
import { documentFieldBlockers } from "../src/domain/document-model";
import { encumbranceDecisionNeeded, kwRequirements } from "../src/domain/kw-requirements";
import type { KwGruntSnapshot, KwSnapshot } from "../src/domain/kw-snapshot";
import { approvalGate, type GateResult, type InputsProvenance } from "../src/domain/provenance";
import type { PropertyRight } from "../src/domain/property-right";
import { DEFAULT_FEATURES, valuationFormSchema } from "../src/lib/valuation-form-schema";

const EMPTY_EXTRACT = {
  kwInne: [],
  powUzytkowaKw: null,
  udzial: null,
  sad: null,
  wydzial: null,
  dataDokumentu: null,
  dzial3: null,
  dzial4: null,
};

/** A fully examined lokal book: source, number, examination date, both dzialy answered. */
const lokalZbadana: KwSnapshot = {
  ...EMPTY_EXTRACT,
  source: "ekw_reczne",
  kwLokalu: "PO1P/1/6",
  kwGruntu: "PO1P/2/4",
  deweloperski: false,
  dataBadania: "2026-09-15",
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
};

/** A fully examined grunt book. */
const gruntZbadana: KwGruntSnapshot = {
  source: "ekw_reczne",
  nrKsiegi: "PO1P/2/4",
  dataBadania: "2026-09-15",
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
};

/** The deed path for a lokal with no book of its own — unchanged by ADR-018. */
const aktDeweloperski: KwSnapshot = {
  ...EMPTY_EXTRACT,
  source: "akt",
  kwLokalu: null,
  kwGruntu: "PO1P/2/4",
  deweloperski: true,
};

type Case = {
  name: string;
  right: PropertyRight;
  kwNumber: string | null;
  kw: KwSnapshot | null;
  kwGrunt?: KwGruntSnapshot | null;
  /** Blocker codes the F-4 gate must report for the KW group. */
  codes: string[];
};

const CASES: Case[] = [
  // Własność — the gap ADR-018 exists to close: every path, the same demand.
  {
    name: "własność · nic (ścieżka ręczna sprzed ADR-018)",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: null,
    codes: ["B-06"],
  },
  {
    name: "własność · sam numer w formularzu (legacy kw_number)",
    right: "wlasnosc_lokalu",
    kwNumber: "PO1P/1/6",
    kw: null,
    codes: ["B-06"],
  },
  {
    name: "własność · snapshot bez daty badania",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: { ...lokalZbadana, dataBadania: null },
    kwGrunt: gruntZbadana,
    codes: ["B-06"],
  },
  {
    name: "własność · księga lokalu bez rozstrzygniętego działu IV",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: { ...lokalZbadana, dzial4: null },
    kwGrunt: gruntZbadana,
    codes: ["B-06"],
  },
  {
    name: "własność · księga lokalu zbadana, brak gruntu",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: lokalZbadana,
    kwGrunt: null,
    codes: ["B-06"],
  },
  {
    name: "własność · grunt bez daty badania",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: lokalZbadana,
    kwGrunt: { ...gruntZbadana, dataBadania: null },
    codes: ["B-06"],
  },
  {
    name: "własność · obie księgi zbadane",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: lokalZbadana,
    kwGrunt: gruntZbadana,
    codes: [],
  },
  // Deweloperski — the lokal has no book, so only the mother book is demanded.
  {
    name: "deweloperski · akt + zbadany grunt",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: aktDeweloperski,
    kwGrunt: gruntZbadana,
    codes: [],
  },
  {
    name: "deweloperski · akt bez zbadanego gruntu",
    right: "wlasnosc_lokalu",
    kwNumber: null,
    kw: aktDeweloperski,
    kwGrunt: null,
    codes: ["B-06"],
  },
  // Spółdzielcze — no KW of its own, nothing demanded (T-12, unchanged).
  {
    name: "spółdzielcze · nic",
    right: "spoldzielcze_wlasnosciowe",
    kwNumber: null,
    kw: null,
    codes: [],
  },
  {
    name: "spółdzielcze · sam numer",
    right: "spoldzielcze_wlasnosciowe",
    kwNumber: "PO1P/1/6",
    kw: null,
    codes: [],
  },
];

const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
const provenance: InputsProvenance = {
  address: confirmed,
  area: confirmed,
  weights: confirmed,
  ratings: confirmed,
  kw: confirmed,
};

const twelveConfirmed = Array.from({ length: 12 }, () => ({
  source: "manual" as const,
  status: "confirmed" as const,
}));

function gateFor(c: Pick<Case, "right" | "kw" | "kwGrunt">, encumbranceTreatment?: unknown) {
  return approvalGate({
    comparables: twelveConfirmed,
    sampleMeta: null,
    provenance,
    propertyRight: c.right,
    kw: c.kw,
    kwGrunt: c.kwGrunt ?? null,
    encumbranceTreatment: encumbranceTreatment as never,
  });
}

/** Only the KW group — the rest of the gate is other sessions' business. */
const kwBlockers = (g: GateResult) =>
  g.ok
    ? []
    : g.blockers.filter((b) => b.path.startsWith("kw") || b.path === "encumbranceTreatment");

describe("B-06 — badanie ksiąg wieczystych, ta sama bramka na każdej ścieżce (I-13 U)", () => {
  it.each(CASES)("$name", (c) => {
    expect(kwBlockers(gateFor(c)).map((b) => b.code)).toEqual(c.codes);
  });

  it("mówi rzeczoznawcy dokładnie jednym komunikatem, czego brakuje (spec §4)", () => {
    expect(kwBlockers(gateFor(CASES[0]))).toEqual([
      {
        path: "kw.badanie",
        code: "B-06",
        label: "Uzupełnij badanie księgi wieczystej: KW lokalu, KW gruntu i datę badania.",
      },
    ]);
  });
});

describe("B-07 — wpis w dziale III księgi lokalu wymaga decyzji o obciążeniu", () => {
  const zWpisem: KwSnapshot = {
    ...lokalZbadana,
    dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania"] },
  };
  const withEntry = (encumbranceTreatment?: unknown) =>
    gateFor({ right: "wlasnosc_lokalu", kw: zWpisem, kwGrunt: gruntZbadana }, encumbranceTreatment);

  it("wpis bez wybranego wariantu → B-07", () => {
    expect(kwBlockers(withEntry())).toEqual([
      {
        path: "encumbranceTreatment",
        code: "B-07",
        label:
          "Księga zawiera ograniczone prawo rzeczowe — wskaż, czy wartość je uwzględnia, i podaj podstawę.",
      },
    ]);
  });

  it("wariant wybrany, ale podstawa pusta → nadal B-07 (podstawę drukuje §10.1)", () => {
    const g = withEntry({ wariant: "bez_uwzglednienia", podstawa: "   " });
    expect(kwBlockers(g).map((b) => b.code)).toEqual(["B-07"]);
  });

  it("wariant z podstawą → brak blokady", () => {
    const g = withEntry({
      wariant: "bez_uwzglednienia",
      podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
    });
    expect(kwBlockers(g)).toEqual([]);
  });

  it("wpisy w dziale III KSIĘGI GRUNTU nie wyzwalają B-07 (RAPORT-diff D-02)", () => {
    const g = gateFor({
      right: "wlasnosc_lokalu",
      kw: lokalZbadana,
      kwGrunt: {
        ...gruntZbadana,
        dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu"] },
      },
    });
    expect(kwBlockers(g)).toEqual([]);
  });

  it("`encumbranceDecisionNeeded` czyta tylko księgę lokalu — żadnej kopii reguły w bramce", () => {
    expect(encumbranceDecisionNeeded(zWpisem, null)).toBe(true);
    expect(encumbranceDecisionNeeded(lokalZbadana, null)).toBe(false);
    expect(encumbranceDecisionNeeded(null, null)).toBe(false);
  });
});

describe("kwRequirements — licznik zbadanych ksiąg dla kroku 1", () => {
  it("własność wymaga dwóch ksiąg; licznik rośnie po zbadaniu każdej", () => {
    expect(kwRequirements("wlasnosc_lokalu", null, null)).toMatchObject({
      wymagane: 2,
      zbadane: 0,
      brakBadania: true,
    });
    expect(kwRequirements("wlasnosc_lokalu", lokalZbadana, null)).toMatchObject({
      wymagane: 2,
      zbadane: 1,
      brakBadania: true,
    });
    expect(kwRequirements("wlasnosc_lokalu", lokalZbadana, gruntZbadana)).toMatchObject({
      wymagane: 2,
      zbadane: 2,
      brakBadania: false,
    });
  });

  it("deweloperski wymaga jednej księgi — macierzystej", () => {
    expect(kwRequirements("wlasnosc_lokalu", aktDeweloperski, gruntZbadana)).toMatchObject({
      ksiegaLokalu: false,
      ksiegaGruntu: true,
      wymagane: 1,
      zbadane: 1,
      brakBadania: false,
    });
  });

  it("spółdzielcze nie wymaga żadnej (T-12)", () => {
    expect(kwRequirements("spoldzielcze_wlasnosciowe", null, null)).toMatchObject({
      ksiegaLokalu: false,
      ksiegaGruntu: false,
      wymagane: 0,
      brakBadania: false,
    });
  });

  it("brak rodzaju prawa (legacy caller) czyta się jak własność — default-deny", () => {
    expect(kwRequirements(undefined, null, null)).toEqual(
      kwRequirements("wlasnosc_lokalu", null, null),
    );
  });
});

describe("pozostałe trzy wywołania reguły — bez zmian po KE.4", () => {
  const step1For = (c: Case) => ({
    address: "ul. Testowa 1",
    area: 50,
    purpose: "sprzedaz" as const,
    client: "Klient",
    propertyRight: c.right,
    kwNumber: c.kwNumber ?? undefined,
    kw: c.kw ?? undefined,
  });
  const kwNumberIssue = (r: {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[] }> };
  }) => !r.success && r.error!.issues.some((i) => i.path[0] === "kwNumber");

  // Step 1 asks for the flat number only on the manual path (no snapshot); the
  // operat's header asks for it whenever the right has a book at all. Neither
  // learned about B-06: path-independence belongs to the gate and must not
  // leak into the header fields, which have no examination to check.
  it.each(CASES)("$name", (c) => {
    const own = c.right === "wlasnosc_lokalu";
    const manualWithoutNumber = own && c.kw == null && c.kwNumber == null;
    expect(kwNumberIssue(step1Schema.safeParse(step1For(c)))).toBe(manualWithoutNumber);
    expect(
      kwNumberIssue(
        valuationFormSchema.safeParse({
          ...step1For(c),
          comparables: Array.from({ length: 3 }, () => ({
            date: "2026-01",
            area: 50,
            pricePerM2: 1,
          })),
          features: DEFAULT_FEATURES,
          inspectionDate: "2026-09-01",
        }),
      ),
    ).toBe(manualWithoutNumber);
    expect(
      documentFieldBlockers({
        purpose: "sprzedaz",
        kwNumber: c.kwNumber,
        propertyRight: c.right,
        client: "Klient",
        inspectionDate: "2026-09-01",
        wr: 1,
      }).some((b) => b.path === "kwNumber"),
    ).toBe(own && c.kwNumber == null);
  });
});
