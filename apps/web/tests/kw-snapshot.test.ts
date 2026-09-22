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
import type { KsiegaTresc } from "../src/domain/kw-tresc";
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

/** Migawka gruntu sprzed ADR-021 — pięć pól, używana w dwóch `describe`. */
const grunt: KwGruntSnapshot = {
  source: "ekw_reczne",
  nrKsiegi: "  PO1P/2/4 ",
  dataBadania: " 2026-09-15 ",
  dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu", ""] },
  dzial4: null,
};

describe("normalizeKwGrunt", () => {
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

describe("ADR-021: ekw_wklej i werdykt przy migawce", () => {
  it("ekw_wklej wchodzi jak dokument (odpis_kw): model przepisał, człowiek potwierdza zapisem", () => {
    expect(kwProvenanceSource("ekw_wklej")).toBe("odpis_kw");
    expect(kwProvenanceSource("ekw_reczne")).toBe("rzeczoznawca");
  });

  it("normalizeKw przenosi werdykt bez zmian — klasy i kody działów, nigdy wartości", () => {
    const werdykt = {
      ok: false,
      bledy: [{ klasa: "pole_niezgodne:udzial", dzial: "I-Sp" }],
      kanal: "tekst" as const,
      plikow: 0,
      at: "2026-09-21T10:00:00.000Z",
    };
    expect(
      normalizeKw({ ...uploaded, source: "ekw_wklej", transkrypcja: werdykt }).transkrypcja,
    ).toEqual(werdykt);
  });

  it("normalizeKwGrunt przycina sąd i wydział i NIE gubi treści ani werdyktu (R2)", () => {
    const tresc = { naglowek: {}, dzialy: [], polaDodatkowe: {} } as unknown as KsiegaTresc;
    const out = normalizeKwGrunt({
      ...grunt,
      source: "ekw_wklej",
      sad: "  Sąd Rejonowy w Testowie ",
      wydzial: " ",
      tresc,
      transkrypcja: {
        ok: true,
        bledy: [],
        kanal: "tekst",
        plikow: 0,
        at: "2026-09-21T10:00:00.000Z",
      },
    });
    expect(out.source).toBe("ekw_wklej");
    expect(out.sad).toBe("Sąd Rejonowy w Testowie");
    expect(out.wydzial).toBeNull();
    expect(out.tresc).toBe(tresc);
    expect(out.transkrypcja?.ok).toBe(true);
  });

  it("stara migawka gruntu bez nowych pól normalizuje się bez zmian (odczyt legacy)", () => {
    expect(normalizeKwGrunt(grunt)).toEqual({
      source: "ekw_reczne",
      nrKsiegi: "PO1P/2/4",
      dataBadania: "2026-09-15",
      dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu"] },
      dzial4: null,
    });
  });
});
