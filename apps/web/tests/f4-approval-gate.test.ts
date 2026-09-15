import { describe, expect, it } from "vitest";
import {
  approvalGate,
  REQUIRED_SAMPLE_SIZE,
  type GateOptions,
  type InputsProvenance,
} from "../src/domain/provenance";
import { documentFieldBlockers } from "../src/domain/document-model";
import type { KwSnapshot } from "../src/domain/kw-snapshot";
import { currentSectionFactsHashes } from "../src/domain/prose-hash";
import type { Feature } from "../src/domain/kcs";
import { approvalBlockers, applyFeaturesUpdate, readFeatureScale } from "../src/domain/valuation";
import { stepForBlockerPath } from "../src/domain/wizard";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function manualRows(n: number) {
  return Array.from({ length: n }, () => ({
    source: "manual" as const,
    status: "confirmed" as const,
  }));
}

describe("F-4: approvalGate (aggregate invariant, default-deny)", () => {
  it("passes with >=12 confirmed rows and a fully confirmed scalar map (no sample fetch)", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result).toEqual({ ok: true });
  });

  it("blocks when any comparable is to_verify, naming the row", () => {
    const rows = manualRows(12);
    rows[2] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({
      comparables: rows,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables[2]");
      expect(result.blockers[0].label).toContain("do weryfikacji");
    }
  });

  it("blocks a comparable with MISSING status as none (default-deny)", () => {
    const rows: Array<{ source?: "rcn" | "manual"; status?: never }> = manualRows(11) as never;
    rows.push({ source: "manual" });
    const result = approvalGate({
      comparables: rows as never,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0].path).toBe("comparables[11]");
      expect(result.blockers[0].label).toContain("brak prowenancji");
    }
  });

  it(`blocks below ${REQUIRED_SAMPLE_SIZE} transactions even when everything is confirmed`, () => {
    const result = approvalGate({
      comparables: manualRows(11),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables");
      expect(result.blockers[0].label).toContain("co najmniej 12");
    }
  });

  it("blocks when the scalar provenance map is missing entirely (default-deny: 4 blockers)", () => {
    const result = approvalGate({ comparables: manualRows(12), sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual([
        "provenance.address",
        "provenance.area",
        "provenance.weights",
        "provenance.ratings",
      ]);
    }
  });

  it("requires a confirmed geocode entry when sampleMeta is present", () => {
    const withMeta = { lat: 52.4, lon: 16.9 };
    const noGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: confirmedScalars,
    });
    expect(noGeocode.ok).toBe(false);
    if (!noGeocode.ok) expect(noGeocode.blockers[0].path).toBe("provenance.geocode");

    const toVerifyGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
    });
    expect(toVerifyGeocode.ok).toBe(false);

    const confirmedGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "confirmed" } },
    });
    expect(confirmedGeocode).toEqual({ ok: true });
  });

  it("does NOT require geocode when there was no sample fetch (sampleMeta absent/null)", () => {
    expect(approvalGate({ comparables: manualRows(12), provenance: confirmedScalars })).toEqual({
      ok: true,
    });
  });

  it("collects ALL blockers at once (count + rows + scalars)", () => {
    const rows = manualRows(3);
    rows[0] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({ comparables: rows, sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 1 count blocker + 1 row blocker + 4 scalar blockers
      expect(result.blockers).toHaveLength(6);
    }
  });

  it("blocks approval when subject fetched but not confirmed", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "Jeżyce" },
      provenance: {
        ...confirmedScalars,
        ewidencja: { source: "ewidencja", status: "to_verify" },
        mpzp: { source: "mpzp", status: "to_verify" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.blockers.map((b) => b.path);
      expect(paths).toContain("provenance.ewidencja");
      expect(paths).toContain("provenance.mpzp");
    }
  });

  it("blocks when subject present but provenance entries missing (default-deny)", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "X" },
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
  });

  it("passes with subject groups confirmed", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "Jeżyce" },
      provenance: {
        ...confirmedScalars,
        ewidencja: { source: "ewidencja", status: "confirmed" },
        mpzp: { source: "mpzp", status: "confirmed" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("does not gate subject when subject absent (legacy)", () => {
    expect(
      approvalGate({ comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars }),
    ).toEqual({ ok: true });
  });
});

describe("kw group (Slice 6)", () => {
  function passingInput() {
    return { comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars };
  }

  const kwOk = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    deweloperski: false,
  };

  it("blocks when kw snapshot present but provenance kw missing (default-deny)", () => {
    const result = approvalGate({ ...passingInput(), kw: kwOk });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.some((b) => b.path === "provenance.kw")).toBe(true);
    }
  });

  it("blocks on to_verify, passes on confirmed", () => {
    const base = passingInput();
    const toVerify = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance, kw: { source: "akt", status: "to_verify" } },
    });
    expect(toVerify.ok).toBe(false);
    const confirmed = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance, kw: { source: "akt", status: "confirmed" } },
    });
    expect(confirmed.ok).toBe(true);
  });

  it("blocks missing kwGruntu and missing kwLokalu (non-developer)", () => {
    const base = passingInput();
    const prov = {
      ...base.provenance,
      kw: { source: "akt" as const, status: "confirmed" as const },
    };
    const noGrunt = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwGruntu: null } });
    expect(noGrunt.ok).toBe(false);
    const noLokal = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwLokalu: null } });
    expect(noLokal.ok).toBe(false);
  });

  it("developer variant: missing kwLokalu is fine when deweloperski", () => {
    const base = passingInput();
    const result = approvalGate({
      ...base,
      provenance: { ...base.provenance, kw: { source: "akt", status: "confirmed" } },
      kw: { ...kwOk, kwLokalu: null, deweloperski: true },
    });
    expect(result.ok).toBe(true);
  });

  // T-12 (S1): the right decides whether KW gruntu is demanded. Absent = legacy
  // caller = własność (the gate stays default-deny for every existing draft).
  it("T-12: spółdzielcze + missing kwGruntu → no blocker; własność/absent → blocker as before", () => {
    const base = passingInput();
    const prov = {
      ...base.provenance,
      kw: { source: "akt" as const, status: "confirmed" as const },
    };
    const noGrunt = { ...kwOk, kwGruntu: null };
    const coop = approvalGate({
      ...base,
      provenance: prov,
      kw: noGrunt,
      propertyRight: "spoldzielcze_wlasnosciowe",
    });
    // S4: the operat is composed per right, so nothing blocks — and nothing
    // about the KW gruntu.
    expect(coop).toEqual({ ok: true });
    const own = approvalGate({
      ...base,
      provenance: prov,
      kw: noGrunt,
      propertyRight: "wlasnosc_lokalu",
    });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.blockers.map((b) => b.path)).toEqual(["kw.kwGruntu"]);
    const legacy = approvalGate({ ...base, provenance: prov, kw: noGrunt });
    expect(legacy.ok).toBe(false);
  });

  it("B-3: spółdzielcze + extract without KW lokalu → no kwLokalu blocker; własność → blocker as before", () => {
    const base = passingInput();
    const prov = {
      ...base.provenance,
      kw: { source: "akt" as const, status: "confirmed" as const },
    };
    const noLokal = { ...kwOk, kwLokalu: null, kwGruntu: null };
    const coop = approvalGate({
      ...base,
      provenance: prov,
      kw: noLokal,
      propertyRight: "spoldzielcze_wlasnosciowe",
    });
    expect(coop).toEqual({ ok: true });
    const own = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwLokalu: null } });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.blockers.map((b) => b.path)).toEqual(["kw.kwLokalu"]);
  });

  it("S4: neither right carries a right-specific blocker on a passing input", () => {
    for (const propertyRight of ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const) {
      expect(approvalGate({ ...passingInput(), propertyRight })).toEqual({ ok: true });
    }
  });

  it("T-12: the sample threshold is the same for both rights", () => {
    for (const propertyRight of ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const) {
      const r = approvalGate({ ...passingInput(), comparables: manualRows(11), propertyRight });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.blockers[0].path).toBe("comparables");
    }
  });

  it("no kw snapshot -> no kw blockers (manual path regression)", () => {
    expect(approvalGate(passingInput()).ok).toBe(true);
  });
});

/**
 * Prose group (FR-6 / ADR-014, Task 7). The whole point of the group: an
 * operat cannot leave without descriptions the appraiser has read and
 * accepted. `requireProse` comes from the app layer (the NEXT_PUBLIC_PROSE
 * kill switch) — the domain never reads env (F-10).
 */
describe("prose group (FR-6, Task 7)", () => {
  const passing = () => ({
    comparables: manualRows(12),
    sampleMeta: null,
    provenance: confirmedScalars,
  });

  it("adds ZERO blockers when requireProse is false — the kill switch is off (CI smoke)", () => {
    // No snapshot at all, and a half-written one: neither may block.
    expect(approvalGate({ ...passing() }, { requireProse: false })).toEqual({ ok: true });
    expect(
      approvalGate(
        {
          ...passing(),
          prose: { sections: { analiza_rynku: confirmedProse().sections.analiza_rynku! } },
        },
        { requireProse: false },
      ),
    ).toEqual({ ok: true });
  });

  it("adds ZERO blockers when no options are passed at all (every legacy call site)", () => {
    expect(approvalGate(passing())).toEqual({ ok: true });
  });

  it("blocks a draft with no prose snapshot at all — ONE blocker, not six", () => {
    const result = approvalGate(passing(), { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        { path: "prose", label: "Opisy sekcji nie zostały wygenerowane." },
      ]);
    }
  });

  it("passes with all six sections confirmed by the appraiser", () => {
    expect(approvalGate({ ...passing(), prose: confirmedProse() }, { requireProse: true })).toEqual(
      {
        ok: true,
      },
    );
  });

  it("blocks a section the appraiser never accepted (ai/to_verify), naming the section", () => {
    const prose = confirmedProse();
    prose.sections.analiza_rynku = {
      value: "Propozycja automatu — dane testowe.",
      provenance: { source: "ai", status: "to_verify" },
    };
    const result = approvalGate({ ...passing(), prose }, { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        {
          path: "prose.analiza_rynku",
          label: "Analiza i charakterystyka rynku — do weryfikacji.",
        },
      ]);
    }
  });

  it("blocks a MISSING section with 'brak tekstu' — an absent section is not an accepted one", () => {
    const prose = confirmedProse();
    delete prose.sections.otoczenie;
    const result = approvalGate({ ...passing(), prose }, { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        {
          path: "prose.otoczenie",
          label: "Charakterystyka bezpośredniego otoczenia — brak tekstu.",
        },
      ]);
    }
  });

  it("blocks whitespace-only text even when its provenance claims confirmed (tampering)", () => {
    const prose = confirmedProse();
    prose.sections.standard = {
      value: "   \n\t ",
      provenance: { source: "rzeczoznawca", status: "confirmed" },
    };
    const result = approvalGate({ ...passing(), prose }, { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual(["prose.standard"]);
      expect(result.blockers[0].label).toContain("brak tekstu");
    }
  });

  it("blocks a section whose provenance key is missing entirely (default-deny)", () => {
    const prose = confirmedProse();
    prose.sections.uzasadnienie = { value: "Tekst bez prowenancji." } as never;
    const result = approvalGate({ ...passing(), prose }, { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0].path).toBe("prose.uzasadnienie");
      expect(result.blockers[0].label).toContain("brak prowenancji");
    }
  });

  /**
   * Staleness (T6 review, I-2; per section since T4). `confirmed` says the
   * appraiser accepted the text; it says nothing about WHICH data the text
   * describes. Editing the sample after step 6 leaves every section confirmed
   * and every sentence about a sample that no longer exists — `uzasadnienie`
   * is literally "the result's standing against the sample". An operat whose
   * prose contradicts its own tables is the failure this slice exists to
   * prevent, so a fingerprint that no longer matches the draft BLOCKS — but
   * only for the sections whose OWN facts moved. One global blocker sent the
   * appraiser back to step 6 to re-read six sections when a single corrected
   * transaction price could have touched two of them.
   */
  it("blocks only the sections whose facts moved, and names them", () => {
    const prose = confirmedProse();
    const gate = approvalGate(
      { ...passing(), prose },
      {
        requireProse: true,
        currentSectionHashes: { ...prose.factsHashes, analiza_rynku: "inny".repeat(16) },
      },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.blockers.map((b) => b.path)).toEqual(["prose.analiza_rynku"]);
      expect(gate.blockers[0]!.label).toContain("Analiza i charakterystyka rynku");
      expect(gate.blockers[0]!.label).toContain("dane się zmieniły");
    }
  });

  it("names every stale section, in the operat's own order", () => {
    const prose = confirmedProse();
    const result = approvalGate(
      { ...passing(), prose },
      {
        requireProse: true,
        currentSectionHashes: {
          ...prose.factsHashes,
          uzasadnienie: "f".repeat(64),
          analiza_rynku: "f".repeat(64),
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual([
        "prose.analiza_rynku",
        "prose.uzasadnienie",
      ]);
    }
  });

  it("passes when every fingerprint still matches", () => {
    const prose = confirmedProse();
    expect(
      approvalGate(
        { ...passing(), prose },
        { requireProse: true, currentSectionHashes: prose.factsHashes },
      ),
    ).toEqual({ ok: true });
  });

  /**
   * The migration path (T2): a snapshot persisted before `factsHashes`
   * existed is normalized to `{}` at the adapter, so every section it holds
   * reads stale — one pass through step 6 per legacy draft, not a silent
   * approval of prose nobody can vouch for.
   */
  it("blocks every populated section of a snapshot that carries no fingerprints at all", () => {
    const prose = { ...confirmedProse(), factsHashes: {} };
    const result = approvalGate(
      { ...passing(), prose },
      { requireProse: true, currentSectionHashes: confirmedProse().factsHashes },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(6);
      expect(result.blockers.every((b) => b.label.includes("dane się zmieniły"))).toBe(true);
    }
  });

  /**
   * One blocker per section, never two: a section the appraiser has not
   * accepted is already blocked as `do weryfikacji`, and repeating the same
   * path with a second sentence would only make the list harder to act on.
   */
  it("says 'do weryfikacji' — not 'dane się zmieniły' — for an unaccepted section", () => {
    const prose = confirmedProse();
    prose.sections.standard = {
      value: "Propozycja automatu — dane testowe.",
      provenance: { source: "ai", status: "to_verify" },
    };
    const result = approvalGate(
      { ...passing(), prose },
      {
        requireProse: true,
        currentSectionHashes: { ...prose.factsHashes, standard: "f".repeat(64) },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        { path: "prose.standard", label: "Opis standardu wykończenia — do weryfikacji." },
      ]);
    }
  });

  it("does not check staleness when the caller cannot compute the hashes", () => {
    // Every production caller passes them (action, both server components,
    // and the adapter computes its own inside the transaction). Omitting them
    // means "I cannot tell" — and inventing a blocker from that would put a
    // false sentence in front of the appraiser.
    expect(approvalGate({ ...passing(), prose: confirmedProse() }, { requireProse: true })).toEqual(
      { ok: true },
    );
    // Same, per section: a map that simply has no entry for a section says
    // nothing about it either.
    expect(
      approvalGate(
        { ...passing(), prose: confirmedProse() },
        { requireProse: true, currentSectionHashes: {} },
      ),
    ).toEqual({ ok: true });
  });

  it("says nothing about staleness when the kill switch is off", () => {
    expect(
      approvalGate(
        { ...passing(), prose: confirmedProse() },
        { requireProse: false, currentSectionHashes: { analiza_rynku: "f".repeat(64) } },
      ),
    ).toEqual({ ok: true });
  });

  it("still collects every OTHER group's blockers alongside the prose ones", () => {
    const prose = confirmedProse();
    delete prose.sections.standard;
    delete prose.sections.otoczenie;
    const result = approvalGate({ comparables: manualRows(3), prose }, { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 1 count blocker + 4 scalar blockers + 2 prose blockers, prose LAST.
      expect(result.blockers).toHaveLength(7);
      expect(result.blockers.map((b) => b.path).slice(-2)).toEqual([
        "prose.otoczenie",
        "prose.standard",
      ]);
    }
  });
});

describe("featureDefs group (Slice 7)", () => {
  it("featureDefs to_verify blocks with a Polish label; legacy provenance without the key does not", () => {
    const blocked = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: { ...confirmedScalars, featureDefs: { source: "preset", status: "to_verify" } },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockers.map((b) => b.path)).toContain("provenance.featureDefs");
      expect(blocked.blockers.find((b) => b.path === "provenance.featureDefs")!.label).toBe(
        "Definicje skali ocen — do weryfikacji.",
      );
    }

    // legacy: no featureDefs key at all → no blocker
    expect(
      approvalGate({ comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars })
        .ok,
    ).toBe(true);
  });
});

/**
 * R-1 (operat-bugfix, paczka 1): `approvalBlockers` is the one composition of
 * the approval gate (step 7, the flat view, the approve action and the domain
 * `approveValuation` all read it). This pins the ORDER and the SHAPES of that
 * list: gate blockers first (none without an inputs snapshot), then the
 * document-field blockers, on every fixture shape below. A new blocker group
 * that lands somewhere else in the list turns these red and has to say so.
 */
describe("R-1: approvalBlockers — pin kolejności i kształtów blokad", () => {
  const ADDRESS = "Audit approvable";

  function gateThenFieldBlockers(v: Valuation, ctx: GateOptions) {
    const gate = v.inputs
      ? approvalGate({ ...v.inputs, propertyRight: v.propertyRight }, ctx)
      : null;
    return [...(gate && !gate.ok ? gate.blockers : []), ...documentFieldBlockers(v)];
  }

  const valuation = (overrides: Partial<Valuation> = {}): Valuation => {
    const input = approvableInput("test-user");
    return {
      id: "valuation-r1",
      address: input.address,
      area: input.area,
      wr: 700_000,
      inputs: input.inputs,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: input.purpose ?? null,
      propertyRight: "wlasnosc_lokalu",
      kwNumber: input.kwNumber ?? null,
      client: input.client ?? null,
      inspectionDate: input.inspectionDate ?? null,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      signedAt: null,
      supersedesId: null,
      mapsFrozenFor: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      ...overrides,
    };
  };

  const ctxFor = (v: Valuation, requireProse: boolean): GateOptions => ({
    requireProse,
    currentSectionHashes:
      requireProse && v.inputs
        ? currentSectionFactsHashes({ address: v.address, inputs: v.inputs })
        : undefined,
  });

  const withProse = (v: Valuation): Valuation => ({
    ...v,
    inputs: { ...v.inputs!, prose: confirmedProseFor(ADDRESS, v.inputs!) },
  });

  const kwConfirmed = { source: "akt" as const, status: "confirmed" as const };
  const kwNoGrunt: KwSnapshot = {
    source: "akt",
    kwLokalu: "AB1C/1/9",
    kwGruntu: null,
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: null,
    udzial: null,
    sad: null,
    wydzial: null,
    dataDokumentu: null,
    dzial3: null,
    dzial4: null,
  };

  const cases: Array<[string, Valuation]> = [
    ["kompletna (confirmed prose)", withProse(valuation())],
    ["bez prozy", valuation()],
    [
      "proza nieaktualna (facts moved on after confirmation)",
      (() => {
        const confirmed = withProse(valuation());
        return { ...confirmed, inputs: { ...confirmed.inputs!, area: 99 } };
      })(),
    ],
    ["bez KW (no number, no extract)", withProse(valuation({ kwNumber: null }))],
    [
      "KW extract without KW gruntu (własność)",
      withProse(
        valuation({
          inputs: {
            ...valuation().inputs!,
            kw: kwNoGrunt,
            provenance: { ...valuation().inputs!.provenance!, kw: kwConfirmed },
          },
        }),
      ),
    ],
    [
      "spółdzielcza (no KW number, extract without KW gruntu)",
      withProse(
        valuation({
          propertyRight: "spoldzielcze_wlasnosciowe",
          kwNumber: null,
          inputs: {
            ...valuation().inputs!,
            kw: kwNoGrunt,
            provenance: { ...valuation().inputs!.provenance!, kw: kwConfirmed },
          },
        }),
      ),
    ],
    [
      "both groups blocked (to_verify sample, missing document fields, no wr)",
      valuation({
        inputs: {
          ...valuation().inputs!,
          comparables: valuation()
            .inputs!.comparables.slice(0, 5)
            .map((c) => ({
              ...c,
              status: "to_verify" as const,
            })),
        },
        purpose: null,
        client: null,
        inspectionDate: null,
        wr: null,
      }),
    ],
    ["legacy draft without inputs snapshot", valuation({ inputs: null })],
    [
      "legacy draft without inputs, document fields missing",
      valuation({ inputs: null, purpose: null, kwNumber: null }),
    ],
  ];

  for (const [name, v] of cases) {
    for (const requireProse of [true, false]) {
      it(`${name} — requireProse=${requireProse}`, () => {
        const ctx = ctxFor(v, requireProse);
        const blockers = approvalBlockers(v, ctx);
        expect(blockers).toEqual(gateThenFieldBlockers(v, ctx));
        // `code` is additive and only the paczka-1 B-xx blockers will set it.
        expect(blockers.every((b) => b.code === undefined)).toBe(true);
      });
    }
  }

  it("the fixture set exercises both empty and non-empty lists, gate and field blockers", () => {
    const all = cases.map(([, v]) => approvalBlockers(v, ctxFor(v, true)));
    expect(all.some((b) => b.length === 0)).toBe(true);
    const paths = [...new Set(all.flat().map((b) => b.path))];
    for (const p of ["prose", "kw.kwGruntu", "kwNumber", "comparables", "purpose", "wr"]) {
      expect(paths, `no case emits "${p}"`).toContain(p);
    }
    // The stale case really is stale: a per-section blocker, not the missing-snapshot one.
    expect(paths.some((p) => p.startsWith("prose."))).toBe(true);
  });
});

/**
 * B-08…B-10 (ADR-016 reg. 3–4, spec §4): the rating scale blocks approval —
 * a missing rating, a rating the scale does not describe, and a weighted
 * feature with fewer than two described levels. Every one links to step 4. A
 * draft whose ratings predate the rule needs no blocker of its own: the read
 * migration clears what is unusable (B-08) and drops an amount that no longer
 * follows from the snapshot, which the gate already refuses as a missing `wr`.
 */
describe("B-08…B-10: rating scale blockers (ADR-016)", () => {
  const LEPSZA_GORSZA = { lepsza: "poniżej 47 m²", gorsza: "47 m² i więcej" };
  const THREE = { lepsza: "lepsza", przecietna: "przeciętna", gorsza: "gorsza" };

  function draft(features: Feature[]): Valuation {
    const input = approvableInput("test-user");
    return {
      id: "valuation-b08",
      address: input.address,
      area: input.area,
      wr: null,
      inputs: { ...input.inputs!, features },
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: input.purpose ?? null,
      propertyRight: "wlasnosc_lokalu",
      kwNumber: input.kwNumber ?? null,
      client: input.client ?? null,
      inspectionDate: input.inspectionDate ?? null,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      signedAt: null,
      supersedesId: null,
      mapsFrozenFor: null,
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    };
  }

  const featureBlockers = (v: Valuation) =>
    approvalBlockers(v, {}).filter((b) => b.code != null && /^B-(08|09|10)$/.test(b.code));

  /** The 14.09 case: powierzchnia rated „przeciętna” on a lepsza/gorsza scale, saved before the rule. */
  const reported = () =>
    draft([
      { name: "Lokalizacja szczegółowa", weight: 0.5, rating: "przecietna", definitions: THREE },
      {
        name: "Powierzchnia użytkowa",
        weight: 0.5,
        rating: "przecietna",
        definitions: LEPSZA_GORSZA,
      },
    ]);

  it("as reported, straight from the snapshot: B-09 on powierzchnia", () => {
    expect(featureBlockers(reported())).toEqual([
      {
        path: "features[1]",
        code: "B-09",
        label:
          "Ocena „przeciętna” cechy „Powierzchnia użytkowa” nie ma opisu w skali — opisz ten poziom albo zmień ocenę.",
      },
    ]);
  });

  it("as reported, after the draft read migration: B-08 on powierzchnia", () => {
    expect(featureBlockers(readFeatureScale(reported())).map((b) => [b.path, b.code])).toEqual([
      ["features[1]", "B-08"],
    ]);
  });

  it("B-08: a feature without a rating", () => {
    const v = draft([{ name: "Standard", weight: 1, rating: null, definitions: THREE }]);
    expect(featureBlockers(v)).toEqual([
      { path: "features[0]", code: "B-08", label: "Wybierz ocenę cechy „Standard”." },
    ]);
  });

  it("B-10: a weighted feature with fewer than two described levels", () => {
    const v = draft([
      { name: "Dodatkowe", weight: 1, rating: "lepsza", definitions: { lepsza: "ogródek" } },
    ]);
    expect(featureBlockers(v)).toEqual([
      {
        path: "features[0]",
        code: "B-10",
        label: "Cecha „Dodatkowe” musi mieć opisane co najmniej dwa poziomy.",
      },
    ]);
  });

  it("after the step-4 save with every rating on its scale: no rating scale blockers", () => {
    const saved = applyFeaturesUpdate(readFeatureScale(reported()), {
      features: [
        { name: "Lokalizacja szczegółowa", weight: 0.5, rating: "przecietna", definitions: THREE },
        {
          name: "Powierzchnia użytkowa",
          weight: 0.5,
          rating: "lepsza",
          definitions: LEPSZA_GORSZA,
        },
      ],
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
    expect(featureBlockers(saved)).toEqual([]);
  });

  it("lands between the F-4 gate and the document fields", () => {
    const v: Valuation = {
      ...reported(),
      purpose: null,
      inputs: { ...reported().inputs!, comparables: [] },
    };
    const codesAndPaths = approvalBlockers(v, {}).map((b) => b.code ?? b.path);
    expect(codesAndPaths).toEqual(["comparables", "B-09", "purpose", "wr"]);
  });

  it("an issued valuation is judged by the same rating rules", () => {
    expect(featureBlockers({ ...reported(), status: "approved" }).map((b) => b.code)).toEqual([
      "B-09",
    ]);
  });

  it("every rating scale blocker links to step 4", () => {
    for (const b of featureBlockers(reported())) {
      expect(stepForBlockerPath(b.path)?.n, b.path).toBe(4);
    }
  });
});
