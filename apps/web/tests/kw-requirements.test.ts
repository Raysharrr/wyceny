/**
 * R-10 (ADR-018 reg. 2): the "KW required" rule used to live in four copies —
 * the two step-1 schemas, the operat's document-field blockers and the F-4
 * gate. `kwRequirements` is now the one source; this file first pins what the
 * four copies did (so the move is provably a refactor), then the rule itself.
 *
 * KW numbers below are short synthetic strings, never the real format (F-9).
 */
import { describe, expect, it } from "vitest";
import { step1Schema } from "../src/app/actions/wizard-schemas";
import { documentFieldBlockers } from "../src/domain/document-model";
import { kwRequirements } from "../src/domain/kw-requirements";
import { approvalGate, type InputsProvenance } from "../src/domain/provenance";
import type { PropertyRight } from "../src/domain/property-right";
import { DEFAULT_FEATURES, valuationFormSchema } from "../src/lib/valuation-form-schema";

type Case = {
  name: string;
  right: PropertyRight;
  kwNumber: string | null;
  kw: { kwLokalu: string | null; kwGruntu: string | null; deweloperski: boolean } | null;
};

const snapshot = (deweloperski: boolean) => ({ kwLokalu: null, kwGruntu: null, deweloperski });

const CASES: Case[] = (["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const).flatMap(
  (right) => [
    { name: `${right} · KW brak`, right, kwNumber: null, kw: null },
    { name: `${right} · sam numer`, right, kwNumber: "AB1C/1/9", kw: null },
    { name: `${right} · snapshot bez numerów`, right, kwNumber: null, kw: snapshot(false) },
    { name: `${right} · snapshot deweloperski`, right, kwNumber: null, kw: snapshot(true) },
  ],
);

const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
const provenance: InputsProvenance = {
  address: confirmed,
  area: confirmed,
  weights: confirmed,
  ratings: confirmed,
  kw: { source: "akt", status: "confirmed" },
};

const EMPTY_EXTRACT = {
  source: "akt" as const,
  kwInne: [],
  powUzytkowaKw: null,
  udzial: null,
  sad: null,
  wydzial: null,
  dataDokumentu: null,
  dzial3: null,
  dzial4: null,
};

/** What each of the four former copies reports for a case, read through its call site. */
function copies(c: Case) {
  const kw = c.kw ? { ...EMPTY_EXTRACT, ...c.kw } : undefined;
  const step1 = {
    address: "ul. Testowa 1",
    area: 50,
    purpose: "sprzedaz",
    client: "Klient",
    propertyRight: c.right,
    kwNumber: c.kwNumber ?? undefined,
    kw,
  };
  const full = {
    ...step1,
    comparables: Array.from({ length: 3 }, () => ({ date: "2026-01", area: 50, pricePerM2: 1 })),
    features: DEFAULT_FEATURES,
    inspectionDate: "2026-09-01",
  };
  const kwNumberIssue = (r: {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[] }> };
  }) => !r.success && r.error!.issues.some((i) => i.path[0] === "kwNumber");
  const gate = approvalGate({
    comparables: Array.from({ length: 12 }, () => ({
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    sampleMeta: null,
    provenance,
    propertyRight: c.right,
    kw: kw ?? null,
  });
  return {
    step1Issue: kwNumberIssue(step1Schema.safeParse(step1)),
    formIssue: kwNumberIssue(valuationFormSchema.safeParse(full)),
    documentBlocker: documentFieldBlockers({
      purpose: "sprzedaz",
      kwNumber: c.kwNumber,
      propertyRight: c.right,
      client: "Klient",
      inspectionDate: "2026-09-01",
      wr: 1,
    }).some((b) => b.path === "kwNumber"),
    gatePaths: gate.ok ? [] : gate.blockers.map((b) => b.path).filter((p) => p.startsWith("kw.")),
  };
}

// The behaviour of the four copies at the time of the move (integration
// branch 6c51c4f). Note the gap on the manual path: without a snapshot the gate
// never asks for the KW gruntu at all — fixed in KE.4, not here.
const BEFORE: Record<string, ReturnType<typeof copies>> = {
  "wlasnosc_lokalu · KW brak": {
    step1Issue: true,
    formIssue: true,
    documentBlocker: true,
    gatePaths: [],
  },
  "wlasnosc_lokalu · sam numer": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: false,
    gatePaths: [],
  },
  "wlasnosc_lokalu · snapshot bez numerów": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: true,
    gatePaths: ["kw.kwGruntu", "kw.kwLokalu"],
  },
  "wlasnosc_lokalu · snapshot deweloperski": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: true,
    gatePaths: ["kw.kwGruntu"],
  },
  "spoldzielcze_wlasnosciowe · KW brak": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: false,
    gatePaths: [],
  },
  "spoldzielcze_wlasnosciowe · sam numer": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: false,
    gatePaths: [],
  },
  "spoldzielcze_wlasnosciowe · snapshot bez numerów": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: false,
    gatePaths: [],
  },
  "spoldzielcze_wlasnosciowe · snapshot deweloperski": {
    step1Issue: false,
    formIssue: false,
    documentBlocker: false,
    gatePaths: [],
  },
};

describe("R-10: the four call sites keep their behaviour", () => {
  it.each(CASES)("$name", (c) => {
    expect(copies(c)).toEqual(BEFORE[c.name]);
  });
});

describe("kwRequirements", () => {
  it.each(CASES)("$name", (c) => {
    const r = kwRequirements(c.right, c.kw);
    const own = c.right === "wlasnosc_lokalu";
    expect(r).toEqual({
      numerKwWFormularzu: own && c.kw == null,
      numerKwWDokumencie: own,
      kwGruntu: own && c.kw != null,
      kwLokalu: own && c.kw != null && !c.kw.deweloperski,
    });
  });

  it("an absent right (legacy caller) reads as własność — default-deny", () => {
    expect(kwRequirements(undefined, null)).toEqual(kwRequirements("wlasnosc_lokalu", null));
  });
});
