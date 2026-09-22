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
import { approvalBlockers, applyFeaturesUpdate, readFeatureScale } from "../src/domain/valuation";
import { blockerTarget, stepForBlockerPath } from "../src/domain/wizard";
import type { AppraiserProfile } from "../src/ports/profile";
import type { Feature } from "../src/domain/kcs";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
  // The examination below is the appraiser's own work, so it enters confirmed
  // (ADR-018 reg. 1). The KW group's own tests override this entry.
  kw: { source: "rzeczoznawca", status: "confirmed" },
};

/**
 * Both books examined. Spread into every input meant to reach the OTHER
 * groups: since ADR-018 the gate asks for the examination on every path
 * (B-06), so an input without one blocks before anything else is tested. The
 * KW group below overrides it on purpose. Numbers are short synthetic strings,
 * never the real format (F-9).
 */
const zbadaneKsiegi = {
  kw: {
    source: "ekw_reczne" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    deweloperski: false,
    dataBadania: "2026-09-15",
    dzial3: { wpisy: false, tresc: [] },
    dzial4: { wpisy: false, tresc: [] },
  },
  kwGrunt: {
    source: "ekw_reczne" as const,
    nrKsiegi: "AB1C/2/7",
    dataBadania: "2026-09-15",
    dzial3: { wpisy: false, tresc: [] },
    dzial4: { wpisy: false, tresc: [] },
  },
};

/**
 * A designation that is chosen and complete (M-10, D-34). Spread into every
 * input meant to reach the OTHER groups, for exactly the reason
 * {@link zbadaneKsiegi} is: B-02 sits OUTSIDE the `subject != null` guard and
 * is therefore asked on every path, so an input without a designation blocks
 * before anything else is tested. The subject group below overrides it on
 * purpose. Fictional plan (F-9).
 */
const wybranePrzeznaczenie = {
  subject: {
    przeznaczenieRodzaj: "mpzp" as const,
    przeznaczenieNazwa: "Plan Testowy",
    przeznaczenieUchwala: "Nr I/1/2020 Rady Miasta Poznania",
    przeznaczenieData: "2020-01-01",
    przeznaczenieSymbol: "1MW/U – tereny zabudowy mieszkaniowej wielorodzinnej",
  },
};

/**
 * The provenance half of {@link wybranePrzeznaczenie}, kept beside it so the
 * two cannot drift apart. Carrying a subject at all opens the EGiB/MPZP group
 * — that group IS gated on the snapshot existing — so these two stamps have to
 * travel with the snapshot. Deliberately NOT folded into
 * {@link confirmedScalars}: the subject group below proves that a snapshot
 * WITHOUT them is refused, and that premise needs a scalar map that lacks them.
 */
const przeznaczenieProv = {
  ewidencja: { source: "rzeczoznawca" as const, status: "confirmed" as const },
  mpzp: { source: "rzeczoznawca" as const, status: "confirmed" as const },
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
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(result).toEqual({ ok: true });
  });

  it("blocks when any comparable is to_verify, naming the row", () => {
    const rows = manualRows(12);
    rows[2] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: rows,
      sampleMeta: null,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
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
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0].path).toBe("comparables[11]");
      expect(result.blockers[0].label).toContain("brak prowenancji");
    }
  });

  it(`blocks below ${REQUIRED_SAMPLE_SIZE} transactions even when everything is confirmed`, () => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(11),
      sampleMeta: null,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables");
      expect(result.blockers[0].label).toContain("co najmniej 12");
    }
  });

  it("blocks when the scalar provenance map is missing entirely (default-deny)", () => {
    // Nothing supplied at all — so the KW examination is missing too, and says
    // so in the same breath as the four scalars (ADR-018: B-06 is asked of
    // every draft, not only of one that already uploaded something).
    const result = approvalGate({ comparables: manualRows(12), sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual([
        "provenance.address",
        "provenance.area",
        "provenance.weights",
        "provenance.ratings",
        // B-02 (M-10) joins the same breath, and for the same reason: it is
        // asked of every draft, not only of one that already has a snapshot.
        "subject.przeznaczenieRodzaj",
        "kw.badanie",
      ]);
    }
  });

  it("requires a confirmed geocode entry when sampleMeta is present", () => {
    const withMeta = { lat: 52.4, lon: 16.9 };
    const noGeocode = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(noGeocode.ok).toBe(false);
    if (!noGeocode.ok) expect(noGeocode.blockers[0].path).toBe("provenance.geocode");

    const toVerifyGeocode = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: {
        ...confirmedScalars,
        ...przeznaczenieProv,
        geocode: { source: "geokoder", status: "to_verify" },
      },
    });
    expect(toVerifyGeocode.ok).toBe(false);

    const confirmedGeocode = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: {
        ...confirmedScalars,
        ...przeznaczenieProv,
        geocode: { source: "geokoder", status: "confirmed" },
      },
    });
    expect(confirmedGeocode).toEqual({ ok: true });
  });

  it("does NOT require geocode when there was no sample fetch (sampleMeta absent/null)", () => {
    expect(
      approvalGate({
        ...zbadaneKsiegi,
        ...wybranePrzeznaczenie,
        comparables: manualRows(12),
        provenance: { ...confirmedScalars, ...przeznaczenieProv },
      }),
    ).toEqual({ ok: true });
  });

  it("collects ALL blockers at once (count + rows + scalars)", () => {
    const rows = manualRows(3);
    rows[0] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({ comparables: rows, sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 1 count blocker + 1 row blocker + 4 scalar blockers + the designation
      // (B-02) + the KW examination
      expect(result.blockers).toHaveLength(8);
    }
  });

  it("blocks approval when subject fetched but not confirmed", () => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      comparables: manualRows(12),
      sampleMeta: null,
      // The designation travels WITH the snapshot: this group is about the
      // EGiB/MPZP provenance stamps, so B-02 must not fire and steal the result.
      subject: { ...wybranePrzeznaczenie.subject, obreb: "Jeżyce" },
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
      ...zbadaneKsiegi,
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { ...wybranePrzeznaczenie.subject, obreb: "X" },
      // Deliberately WITHOUT `przeznaczenieProv`: the premise is a snapshot
      // whose EGiB/MPZP stamps are missing, which default-deny must refuse.
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
  });

  it("passes with subject groups confirmed", () => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { ...wybranePrzeznaczenie.subject, obreb: "Jeżyce" },
      provenance: {
        ...confirmedScalars,
        ewidencja: { source: "ewidencja", status: "confirmed" },
        mpzp: { source: "mpzp", status: "confirmed" },
      },
    });
    expect(result.ok).toBe(true);
  });

  /**
   * ⚠️ Meaning CHANGED at M-10. Until then "no snapshot" meant "no subject
   * demand at all", and this asserted `{ ok: true }`. It cannot any more: B-02
   * is asked outside the `subject != null` guard precisely BECAUSE the 14.09
   * valuation was typed in by hand with no snapshot and slipped past every
   * check that lived inside it. So the thing this test actually protects — the
   * EGiB/MPZP provenance group staying silent when there is nothing to stamp —
   * is now asserted directly, with B-02 named as the one blocker that remains.
   */
  it("leaves the EGiB/MPZP group silent when subject absent, but still asks B-02 (legacy)", () => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.blockers.map((b) => b.path);
      expect(paths).toEqual(["subject.przeznaczenieRodzaj"]);
      expect(paths).not.toContain("provenance.ewidencja");
      expect(paths).not.toContain("provenance.mpzp");
    }
  });

  /**
   * B-02 (M-10, D-34) — the rule this whole change exists to defend. §9 prints
   * ONE sentence naming the source of the designation; a sentence that names a
   * source it cannot identify, or identifies one without the symbol read out of
   * it, is exactly what Aneta reported on the 14.09 operat. So all five parts,
   * or no approval — half-filled is refused just as hard as unchosen.
   */
  it.each([
    ["nie wybrano podstawy", undefined],
    ["wybrano MPZP, brak symbolu", { ...wybranePrzeznaczenie.subject, przeznaczenieSymbol: "" }],
    ["wybrano MPZP, brak uchwały", { ...wybranePrzeznaczenie.subject, przeznaczenieUchwala: "" }],
    ["wybrano MPZP, brak daty", { ...wybranePrzeznaczenie.subject, przeznaczenieData: "" }],
    ["wybrano MPZP, brak nazwy", { ...wybranePrzeznaczenie.subject, przeznaczenieNazwa: "" }],
    // `plan_ogolny` on purpose, not incidentally: it is the branch the Poznań
    // prefill fills, and picking a source is NOT the same as completing it —
    // the prefill offers the resolution but never the symbol, which is read off
    // the map for THIS parcel. So the half-filled state is reachable in the UI.
    ["sam rodzaj, bez reszty", { przeznaczenieRodzaj: "plan_ogolny" as const }],
  ])("B-02 blokuje: %s", (_label, subject) => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      comparables: manualRows(12),
      sampleMeta: null,
      ...(subject ? { subject } : {}),
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const b02 = result.blockers.find((b) => b.code === "B-02");
      expect(b02, "B-02 nie pojawił się").toBeDefined();
      expect(b02!.path).toBe("subject.przeznaczenieRodzaj");
    }
  });

  it("B-02 milczy, gdy wszystkie pięć części przeznaczenia jest wypełnione", () => {
    const result = approvalGate({
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    });
    expect(result).toEqual({ ok: true });
  });
});

/**
 * B-01 (M-1, D-01) — zdjęcie budynku z zewnątrz. Od M-1 PIERWSZE zdjęcie tej
 * sekcji drukuje się na okładce operatu, więc szkic bez niego wydałby dokument
 * z pustą stroną 1: dokładnie ten defekt zgłosiła Aneta. Blokada wisi na
 * przełączniku `requirePhotos`, bo build z wyłączonym wgrywaniem zdjęć (tak
 * chodzi pakiet e2e) nie umiałby jej spełnić — ten sam układ co FR-6
 * i `requireProse`: wyłącznik ZDEJMUJE wymaganie, nie udaje spełnionego.
 */
describe("B-01: zdjęcie budynku, czyli okładka (M-1)", () => {
  const kompletny = {
    ...zbadaneKsiegi,
    ...wybranePrzeznaczenie,
    comparables: manualRows(12),
    sampleMeta: null,
    provenance: { ...confirmedScalars, ...przeznaczenieProv },
  };
  const zdjecia = (photos: {
    otoczenie?: string[];
    budynekZewn?: string[];
    wnetrza?: string[];
  }) => ({
    inspection: {
      note: null,
      photos: { otoczenie: [], budynekZewn: [], wnetrza: [], ...photos },
    },
  });

  it("blokuje szkic bez zdjęcia budynku i nazywa sekcję", () => {
    const result = approvalGate(kompletny, { requirePhotos: true });
    expect(result.ok).toBe(false);
    const b01 = result.ok ? undefined : result.blockers.find((b) => b.code === "B-01");
    expect(b01?.path).toBe("inspection.photos.budynekZewn");
    expect(b01?.label).toContain("Budynek z zewnątrz");
  });

  it("milczy, gdy jest co najmniej jedno zdjęcie budynku", () => {
    expect(
      approvalGate(
        { ...kompletny, ...zdjecia({ budynekZewn: ["budynek-1.jpg"] }) },
        {
          requirePhotos: true,
        },
      ),
    ).toEqual({ ok: true });
  });

  it("zdjęcia z pozostałych sekcji nie zastępują budynku — okładka bierze z tej jednej", () => {
    const result = approvalGate(
      { ...kompletny, ...zdjecia({ otoczenie: ["a.jpg"], wnetrza: ["b.jpg"] }) },
      { requirePhotos: true },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.blockers.map((b) => b.code)).toContain("B-01");
  });

  it("wyłącznik wgrywania zdejmuje wymaganie zamiast udawać, że jest spełnione", () => {
    expect(approvalGate(kompletny, { requirePhotos: false })).toEqual({ ok: true });
    expect(approvalGate(kompletny)).toEqual({ ok: true });
  });
});

/**
 * KW group (Slice 6, rewritten for ADR-018). Until 15.09 the whole group lived
 * inside `if (input.kw != null)`, so the manual path — the one the office
 * actually uses — met no demand at all while the operat still claimed both
 * books had been examined. The group now asks the same question of every path,
 * and asks it once: B-06 instead of the old pair of number blockers.
 */
describe("kw group (Slice 6, ADR-018)", () => {
  function passingInput() {
    return {
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: { ...confirmedScalars, ...przeznaczenieProv },
    };
  }

  const kwOk = zbadaneKsiegi.kw;
  const codes = (r: ReturnType<typeof approvalGate>) =>
    r.ok ? [] : r.blockers.map((b) => b.code ?? b.path);

  it("blocks when kw snapshot present but provenance kw missing (default-deny)", () => {
    const base = passingInput();
    const result = approvalGate({ ...base, provenance: { ...base.provenance, kw: undefined } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.some((b) => b.path === "provenance.kw")).toBe(true);
    }
  });

  it("blocks on to_verify, passes on confirmed", () => {
    const base = passingInput();
    const toVerify = approvalGate({
      ...base,
      provenance: { ...base.provenance, kw: { source: "odpis_kw", status: "to_verify" } },
    });
    expect(toVerify.ok).toBe(false);
    expect(approvalGate(base)).toEqual({ ok: true });
  });

  // The regression this whole block exists for (I-13 U). Before ADR-018 each
  // of these passed the gate: no snapshot meant no question asked.
  it.each([
    ["nic — ścieżka ręczna sprzed ADR-018", { kw: null, kwGrunt: null }],
    ["sam numer, bez daty badania", { kw: { ...kwOk, dataBadania: null } }],
    ["dział IV bez odpowiedzi Brak wpisów / Są wpisy", { kw: { ...kwOk, dzial4: null } }],
    ["księga lokalu zbadana, księgi gruntu nie zbadano", { kwGrunt: null }],
    ["grunt bez daty badania", { kwGrunt: { ...zbadaneKsiegi.kwGrunt, dataBadania: null } }],
    ["akt notarialny sam z siebie nie jest badaniem księgi", { kw: { ...kwOk, source: "akt" } }],
  ] as const)("B-06: %s", (_name, override) => {
    expect(codes(approvalGate({ ...passingInput(), ...override }))).toEqual(["B-06"]);
  });

  it("deweloperski: lokal bez własnej księgi wymaga tylko księgi macierzystej", () => {
    const base = passingInput();
    const akt = { ...kwOk, source: "akt" as const, kwLokalu: null, deweloperski: true };
    expect(approvalGate({ ...base, kw: akt })).toEqual({ ok: true });
    expect(codes(approvalGate({ ...base, kw: akt, kwGrunt: null }))).toEqual(["B-06"]);
  });

  // T-12 (S1): the right decides whether any book is demanded at all. Absent =
  // legacy caller = własność (the gate stays default-deny for every draft).
  it("T-12: spółdzielcze nie wymaga żadnej księgi; własność i brak rodzaju wymagają", () => {
    const bare = { ...passingInput(), kw: null, kwGrunt: null };
    expect(approvalGate({ ...bare, propertyRight: "spoldzielcze_wlasnosciowe" })).toEqual({
      ok: true,
    });
    expect(codes(approvalGate({ ...bare, propertyRight: "wlasnosc_lokalu" }))).toEqual(["B-06"]);
    expect(codes(approvalGate(bare))).toEqual(["B-06"]);
  });

  it("B-07: wpis w dziale III księgi lokalu bez decyzji o obciążeniu blokuje", () => {
    const base = passingInput();
    const zWpisem = { ...kwOk, dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania"] } };
    expect(codes(approvalGate({ ...base, kw: zWpisem }))).toEqual(["B-07"]);
    expect(
      approvalGate({
        ...base,
        kw: zWpisem,
        encumbranceTreatment: {
          wariant: "bez_uwzglednienia",
          podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
        },
      }),
    ).toEqual({ ok: true });
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

  it("obie księgi zbadane → grupa milczy", () => {
    expect(approvalGate(passingInput())).toEqual({ ok: true });
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
    ...zbadaneKsiegi,
    ...wybranePrzeznaczenie,
    comparables: manualRows(12),
    sampleMeta: null,
    provenance: { ...confirmedScalars, ...przeznaczenieProv },
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

  it("blocks a draft with no prose snapshot at all — ONE blocker, not seven", () => {
    const result = approvalGate(passing(), { requireProse: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        { path: "prose", label: "Opisy sekcji nie zostały wygenerowane." },
      ]);
    }
  });

  it("passes with all seven sections confirmed by the appraiser", () => {
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
   * appraiser back to step 6 to re-read every section when a single corrected
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
      expect(result.blockers).toHaveLength(7);
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
      // 1 count + 4 scalars + the designation (B-02) + the KW examination
      // + 2 prose blockers, prose LAST.
      expect(result.blockers).toHaveLength(9);
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
      ...zbadaneKsiegi,
      ...wybranePrzeznaczenie,
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
      approvalGate({
        ...zbadaneKsiegi,
        ...wybranePrzeznaczenie,
        comparables: manualRows(12),
        sampleMeta: null,
        provenance: { ...confirmedScalars, ...przeznaczenieProv },
      }).ok,
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
      "akt bez zbadanej księgi lokalu (własność) — B-06",
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
      "spółdzielcza (no KW number, akt bez badania) — bez B-06",
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
        // `code` is additive: a blocker either carries a paczka-1 catalogue id
        // (B-06/B-07 so far) or nothing at all — never an ad-hoc string.
        expect(blockers.every((b) => b.code === undefined || /^B-\d\d$/.test(b.code))).toBe(true);
      });
    }
  }

  it("the fixture set exercises both empty and non-empty lists, gate and field blockers", () => {
    const all = cases.map(([, v]) => approvalBlockers(v, ctxFor(v, true)));
    expect(all.some((b) => b.length === 0)).toBe(true);
    const paths = [...new Set(all.flat().map((b) => b.path))];
    for (const p of ["prose", "kw.badanie", "kwNumber", "comparables", "purpose", "wr"]) {
      expect(paths, `no case emits "${p}"`).toContain(p);
    }
    // The stale case really is stale: a per-section blocker, not the missing-snapshot one.
    expect(paths.some((p) => p.startsWith("prose."))).toBe(true);
  });
});

describe("B-15, B-16: profil autora i polisa OC (ADR-020 reg. 3, spec §4)", () => {
  /** Fikcyjne dane — żadne nazwisko ani numer uprawnień nie jest prawdziwy (F-9, R10). */
  const kompletnyProfil: AppraiserProfile = {
    fullName: "Jan Testowy",
    licenseNo: "0000",
    officeBlock: "Biuro Wycen Testowe\nul. Przykładowa 1\n60-000 Poznań",
    insuranceDocKey: "polisa/test-user/abc123",
    insuranceValidUntil: "2026-12-31",
  };
  /** Godzina ≠ 00:00 celowo: data operatu to dzień, nie moment. */
  const DATA_OPERATU = new Date("2026-09-15T14:30:00.000Z");

  /** Wycena bez zarzutów po stronie danych — zostają same blokady profilu. */
  const czystaWycena = (): Valuation => {
    const input = approvableInput("test-user");
    return {
      id: "valuation-b15",
      address: input.address,
      area: input.area,
      wr: 700_000,
      inputs: { ...input.inputs!, prose: confirmedProseFor(input.address, input.inputs!) },
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
    };
  };

  const kody = (author: AppraiserProfile | null, today = DATA_OPERATU) => {
    const v = czystaWycena();
    return approvalBlockers(v, {
      requireProse: true,
      currentSectionHashes: currentSectionFactsHashes({ address: v.address, inputs: v.inputs! }),
      author,
      today,
    }).map((b) => b.code);
  };

  it("kompletny profil z ważną polisą nie wnosi żadnej blokady", () => {
    expect(kody(kompletnyProfil)).toEqual([]);
  });

  it("brak wiersza profilu podnosi obie blokady naraz", () => {
    expect(kody(null)).toEqual(["B-15", "B-16"]);
  });

  it.each(["fullName", "licenseNo", "officeBlock"] as const)(
    "brak pola %s podnosi B-15 z komunikatem ze specu",
    (pole) => {
      const v = czystaWycena();
      const blockers = approvalBlockers(v, {
        requireProse: true,
        currentSectionHashes: currentSectionFactsHashes({ address: v.address, inputs: v.inputs! }),
        author: { ...kompletnyProfil, [pole]: null },
        today: DATA_OPERATU,
      });
      expect(blockers).toEqual([
        {
          path: "profile.dane",
          code: "B-15",
          label: "Uzupełnij profil: imię i nazwisko, numer uprawnień, dane biura.",
        },
      ]);
    },
  );

  it("same białe znaki w polu autora to wciąż brak (B-15)", () => {
    expect(kody({ ...kompletnyProfil, officeBlock: "   \n  " })).toEqual(["B-15"]);
  });

  it("brak pliku polisy podnosi B-16 z datą operatu w formacie dd.mm.rrrr", () => {
    const v = czystaWycena();
    const blockers = approvalBlockers(v, {
      requireProse: true,
      currentSectionHashes: currentSectionFactsHashes({ address: v.address, inputs: v.inputs! }),
      author: { ...kompletnyProfil, insuranceDocKey: null },
      today: DATA_OPERATU,
    });
    expect(blockers).toEqual([
      {
        path: "profile.polisa",
        code: "B-16",
        label: "Dodaj polisę OC ważną na dzień 15.09.2026.",
      },
    ]);
  });

  it("polisa ważna do dnia PRZED datą operatu podnosi B-16", () => {
    expect(kody({ ...kompletnyProfil, insuranceValidUntil: "2026-09-14" })).toEqual(["B-16"]);
  });

  /**
   * Granica, o którą najłatwiej się potknąć: `insurance_valid_until` to kolumna
   * `date`, a data operatu ma godzinę. Porównanie dat jako obiektów `Date`
   * odrzuciłoby polisę ważną dokładnie tyle, ile trzeba.
   */
  it("polisa ważna dokładnie do daty operatu NIE podnosi B-16", () => {
    expect(kody({ ...kompletnyProfil, insuranceValidUntil: "2026-09-15" })).toEqual([]);
  });

  it("nieobecny `author` w kontekście nie sprawdza profilu (precedens requireProse)", () => {
    const v = czystaWycena();
    const blockers = approvalBlockers(v, {
      requireProse: true,
      currentSectionHashes: currentSectionFactsHashes({ address: v.address, inputs: v.inputs! }),
    });
    expect(blockers).toEqual([]);
  });

  it("każda blokada profilu prowadzi na /profile, nie do kroku kreatora", () => {
    for (const path of ["profile.dane", "profile.polisa"]) {
      expect(blockerTarget(path)).toEqual({
        kind: "page",
        href: "/profile",
        label: "Profil rzeczoznawcy",
      });
      expect(stepForBlockerPath(path)).toBeUndefined();
    }
  });

  it("każda blokada z pustej wyceny ma cel: krok kreatora albo /profile", () => {
    const pusta: Valuation = { ...czystaWycena(), purpose: null, client: null, wr: null };
    const blockers = approvalBlockers(pusta, {
      requireProse: true,
      author: null,
      today: DATA_OPERATU,
    });
    expect(blockers.length).toBeGreaterThan(0);
    for (const b of blockers) {
      expect(blockerTarget(b.path), `brak celu dla "${b.path}"`).toBeDefined();
    }
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
      comparableRatings: null,
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
