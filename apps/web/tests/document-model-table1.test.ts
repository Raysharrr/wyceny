import { describe, it, expect } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
import type { Candidate } from "../src/domain/sample-selection";

const NBSP = " "; // non-breaking space (escape — a pasted literal is invisible to review)

const cand = (
  id: string,
  teryt: string,
  obreb: string,
  distanceM: number,
  address: Partial<Pick<Candidate, "street" | "streetNumber" | "city">> = {},
): Candidate => ({
  transactionId: id,
  date: "2026-05-10",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: { teryt, obreb, arkusz: "22", dzialka: "13/82", budynek: "1", lokal: "1" },
  lokalId: `${teryt}.${obreb}.x`,
  distanceM,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos: null,
  ...address,
});

describe("Tabela 1 — Data | Miasto | Ulica (Slice 3d, układ operatu wzorcowego)", () => {
  it("prints the transaction's OWN city and street; manual rows print dashes", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "T1",
        lokalId: "306401_1.0039.x",
      },
      {
        date: "2026-04-01",
        area: 52,
        pricePerM2: 11000,
        source: "rcn",
        transactionId: "T2",
        lokalId: "302104_2.0006.x",
      },
      { date: "2026-03-01", area: 48, pricePerM2: 13000, source: "manual" },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [
        cand("T1", "306401_1", "0039", 123.4, {
          street: "ul. Kościelna",
          streetNumber: "33A",
          city: "Poznań",
        }),
      ],
      // Sąsiednia gmina: eksport miejski jej nie obejmuje, więc kreska w obu kolumnach.
      alternates: [cand("T2", "302104_2", "0006", 2875)],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.miasto, r.ulica])).toEqual([
      ["Poznań", "Kościelna"], // „ul.” obcięte, numer NIE trafia do dokumentu (F-12)
      ["gm. 302104", "—"], // spoza Poznania: miasto z TERYT-u, ulicy eksport nie zna
      ["—", "—"], // wiersz ręczny: brak kandydatki, więc nic nie wiemy
    ]);
    expect(JSON.stringify(m.transakcje)).not.toContain("T1");
    expect(JSON.stringify(m.transakcje)).not.toContain("33A");
    // Obręb i odległość zostają w kroku 3 — operat wzorcowy ich nie ma.
    expect("obreb" in m.transakcje[0]).toBe(false);
    expect("odleglosc" in m.transakcje[0]).toBe(false);
  });

  it("takes the city from the TRANSACTION, never from the subject — the bug Łukasz reported", () => {
    // `cityFromAddress` wpisywał adres przedmiotu w każdy wiersz („wszystkie z Heweliusza
    // 3/43”). Miasto ma pochodzić z rekordu transakcji, także gdy leży poza Poznaniem.
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "T1",
        lokalId: "302104_2.0006.x",
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [
        cand("T1", "302104_2", "0006", 2875, {
          street: "ul. Poznańska",
          streetNumber: "7",
          city: "Luboń",
        }),
      ],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje[0]).toMatchObject({ miasto: "Luboń", ulica: "Poznańska" });
  });

  it("two lokale of ONE notarial act print their OWN street, never one lokal's twice (Heweliusza 3/43)", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    const lokalA = cand("ACT1", "306401_1", "0039", 100, {
      street: "ul. Heweliusza",
      streetNumber: "3",
      city: "Poznań",
    });
    const lokalB = cand("ACT1", "302104_2", "0006", 200, {
      street: "ul. Poznańska",
      streetNumber: "7",
      city: "Luboń",
    });
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50.63,
        pricePerM2: 7505.43,
        source: "rcn",
        transactionId: "ACT1",
        lokalId: lokalA.lokalId,
      },
      {
        date: "2026-05-10",
        area: 38.19,
        pricePerM2: 7541.24,
        source: "rcn",
        transactionId: "ACT1",
        lokalId: lokalB.lokalId,
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [lokalA, lokalB],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 2 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.miasto, r.ulica])).toEqual([
      ["Poznań", "Heweliusza"],
      ["Luboń", "Poznańska"],
    ]);
  });

  it("a row matched only by transactionId prints a dash, not the first lokal's street", () => {
    // `byFirstTransactionId` picks SOME lokal of the act. For obręb that was nearly
    // invisible; a street name in an operat is a factual claim about a comparable.
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    const lokalA = cand("ACT1", "306401_1", "0039", 100, {
      street: "ul. Heweliusza",
      streetNumber: "3",
      city: "Poznań",
    });
    input.inputs.comparables = [
      { date: "2026-05-10", area: 50, pricePerM2: 12000, source: "rcn", transactionId: "ACT1" },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [lokalA],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje[0]).toMatchObject({ miasto: "—", ulica: "—" });
  });

  it("a manual inclusion re-attached after a radius change prints its own street, not dashes (final wave, I1)", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    // The candidate lives ONLY in `manualInclusions` — it fell out of both
    // `proposed` and `alternates` when the radius shrank, but the
    // appraiser's explicit addition survives via the carried `candidate`
    // payload (`applyManualOverlay` re-attaches it; see `sample-manual.ts`).
    const reattached = cand("M1", "306401_1", "0039", 456.7, {
      street: "ul. Kościelna",
      streetNumber: "33A",
      city: "Poznań",
    });
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "M1",
        lokalId: reattached.lokalId,
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [],
      alternates: [],
      manualInclusions: [
        {
          transactionId: "M1",
          lokalId: reattached.lokalId,
          at: "2026-08-21T10:00:00Z",
          candidate: reattached,
        },
      ],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 500,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 0 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.miasto, r.ulica])).toEqual([["Poznań", "Kościelna"]]);
  });
});

describe("Tabela 1 — miasto, gdy eksport nie ma adresu (decyzja użytkownika 2026-08-22)", () => {
  const rcnRow = (lokalId: string) =>
    [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "T1",
        lokalId,
      },
    ] as never;

  function render(candidate: Candidate) {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    input.inputs.comparables = rcnRow(candidate.lokalId);
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [candidate],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    return buildDocumentModel(input).transakcje[0];
  }

  it("transakcja spoza Poznania: gmina z TERYT-u w „Mieście”, kreska w „Ulicy”", () => {
    // Przed 3d taki wiersz miał „0006 · gm. 302104” w kolumnie Obręb — operat nie może
    // stracić informacji o położeniu porównania tylko dlatego, że miejski eksport
    // nie obejmuje gmin ościennych.
    expect(render(cand("T1", "302104_2", "0006", 2875))).toMatchObject({
      miasto: "gm. 302104",
      ulica: "—",
    });
  });

  it("lokal w Poznaniu bez adresu w eksporcie: „Poznań” z TERYT-u, kreska w „Ulicy”", () => {
    expect(render(cand("T1", "306401_1", "0039", 120))).toMatchObject({
      miasto: "Poznań",
      ulica: "—",
    });
  });

  it("nieparsowalny identyfikator: kreska w obu — nigdy zgadywanie", () => {
    const broken = { ...cand("T1", "306401_1", "0039", 120), egib: null };
    expect(render(broken)).toMatchObject({ miasto: "—", ulica: "—" });
  });
});
