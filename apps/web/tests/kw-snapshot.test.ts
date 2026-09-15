/**
 * Two books, one type (ADR-018 reg. 1, decyzja usera 15.09). The examination
 * of the lokal's book is the same `KwSnapshot` whether the data came from a
 * PDF (`odpis_kw`), a deed (`akt`) or the appraiser reading eKW in a browser
 * (`ekw_reczne`); the grunt's book is its own, smaller snapshot, manual-only
 * in paczka 1. This file pins the normalization both share.
 *
 * KW numbers here are short synthetic strings, never the real format (F-9).
 */
import { describe, expect, it } from "vitest";
import {
  kwProvenanceSource,
  normalizeKw,
  normalizeKwGrunt,
  type KwGruntSnapshot,
  type KwSnapshot,
} from "../src/domain/kw-snapshot";
import { assignSubjectProvenance } from "../src/lib/assign-provenance";

/** An upload-shaped snapshot: exactly the fields the extractor has always emitted. */
const uploaded: KwSnapshot = {
  source: "odpis_kw",
  kwLokalu: "  PO1P/1/6  ",
  kwGruntu: "",
  kwInne: [" ", "PO1P/2/4"],
  deweloperski: false,
  powUzytkowaKw: 44.23,
  udzial: " 4423/6126030 ",
  sad: "  ",
  wydzial: "V Wydział Ksiąg Wieczystych",
  dataDokumentu: " 2015-03-20 ",
  dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania", "  ", ""] },
  dzial4: { wpisy: false, tresc: [] },
};

describe("normalizeKw — one implementation for all three sources", () => {
  it("an upload snapshot carrying none of the new fields still normalizes (odczyt legacy bez migracji)", () => {
    const out = normalizeKw(uploaded);
    expect(out).toMatchObject({
      source: "odpis_kw",
      kwLokalu: "PO1P/1/6",
      kwGruntu: null,
      kwInne: ["PO1P/2/4"],
      udzial: "4423/6126030",
      sad: null,
      dataDokumentu: "2015-03-20",
      dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania"] },
      dzial4: { wpisy: false, tresc: [] },
    });
  });

  it("normalizes a manual examination (ekw_reczne) exactly like an upload", () => {
    const out = normalizeKw({
      ...uploaded,
      source: "ekw_reczne",
      dataBadania: " 2026-09-15 ",
      nrLokalu: " 12 ",
    });
    expect(out.source).toBe("ekw_reczne");
    expect(out.dataBadania).toBe("2026-09-15");
    expect(out.nrLokalu).toBe("12");
    // The manual dzialy get the SAME treatment as the extractor's — ADR-018
    // "Zmiana 15.09" drops PII minimization from `tresc`, not the trimming.
    expect(out.dzial3).toEqual({ wpisy: true, tresc: ["Służebność osobista mieszkania"] });
  });

  it("trims all three akt fields; an all-blank akt is null, not a row of empty strings", () => {
    const filled = normalizeKw({
      ...uploaded,
      akt: { rodzaj: " Umowa sprzedaży ", rep: " Rep. A 1234/2015 ", data: " 2015-03-20 " },
    });
    expect(filled.akt).toEqual({
      rodzaj: "Umowa sprzedaży",
      rep: "Rep. A 1234/2015",
      data: "2015-03-20",
    });
    expect(normalizeKw({ ...uploaded, akt: { rodzaj: "  ", rep: "", data: " " } }).akt).toBeNull();
    // A partly-filled akt survives: an appraiser who has the title but not the
    // Rep. number must not silently lose what they did type.
    expect(
      normalizeKw({ ...uploaded, akt: { rodzaj: "Umowa darowizny", rep: "", data: "" } }).akt,
    ).toEqual({ rodzaj: "Umowa darowizny", rep: "", data: "" });
  });

  it("leaves dataBadania absent rather than inventing today — the default date is the form's job", () => {
    expect(normalizeKw(uploaded).dataBadania ?? null).toBeNull();
    expect(normalizeKw({ ...uploaded, dataBadania: "   " }).dataBadania).toBeNull();
  });
});

describe("a manual examination is the appraiser's own work (ADR-010 × ADR-018)", () => {
  it("maps `ekw_reczne` to `rzeczoznawca` — the Shared Kernel never learns the new source", () => {
    expect(kwProvenanceSource("ekw_reczne")).toBe("rzeczoznawca");
    expect(kwProvenanceSource("odpis_kw")).toBe("odpis_kw");
    expect(kwProvenanceSource("akt")).toBe("akt");
  });

  it("enters `rzeczoznawca/confirmed`, not `to_verify` against a document nobody holds", () => {
    const manual = normalizeKw({ ...uploaded, source: "ekw_reczne", powUzytkowaKw: 44.23 });
    const p = assignSubjectProvenance({ area: 44.23, kw: manual, kwMeta: undefined });
    expect(p.kw).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    // …and the area the appraiser typed off the same screen is theirs too —
    // it must not be marked doc-sourced just because the numbers agree.
    expect(p.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("an uploaded excerpt keeps its document provenance (no regression)", () => {
    const p = assignSubjectProvenance({
      area: 44.23,
      kw: normalizeKw(uploaded),
      kwMeta: undefined,
    });
    expect(p.kw).toEqual({ source: "odpis_kw", status: "to_verify" });
    expect(p.area).toEqual({ source: "odpis_kw", status: "to_verify" });
  });
});

describe("normalizeKwGrunt", () => {
  const grunt: KwGruntSnapshot = {
    source: "ekw_reczne",
    nrKsiegi: "  PO1P/2/4 ",
    dataBadania: " 2026-09-15 ",
    dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu", ""] },
    dzial4: null,
  };

  it("trims the number and the date, filters the dzial lines, keeps `null` as `null`", () => {
    expect(normalizeKwGrunt(grunt)).toEqual({
      source: "ekw_reczne",
      nrKsiegi: "PO1P/2/4",
      dataBadania: "2026-09-15",
      dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu"] },
      dzial4: null,
    });
  });

  it("`dzial = null` means 'Brak wpisów / Są wpisy not chosen yet' — never rewritten to 'no entries'", () => {
    const out = normalizeKwGrunt({ ...grunt, dzial3: null });
    expect(out.dzial3).toBeNull();
    expect(out.dzial3).not.toEqual({ wpisy: false, tresc: [] });
  });
});
