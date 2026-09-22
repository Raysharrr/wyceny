import { describe, expect, it } from "vitest";
import { approvalBlockers } from "../src/domain/valuation";
import { extremeLokale } from "../src/domain/extremes";
import type { KcsInput } from "../src/domain/kcs";
import type { Valuation } from "../src/ports/valuation";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";

/**
 * B-18 (ADR-022 reg. 5): każdy lokal o cenie skrajnej × każda cecha aktywna
 * bez oceny (albo z oceną na nieopisanym poziomie) blokuje zatwierdzenie.
 * Mutacja obowiązkowa: `extremeLokale → []` w `extremeRatingBlockers` ma
 * zaczerwienić pierwszy test.
 */
function draftOf(inputs: KcsInput): Valuation {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    address: "ul. Testowa 1, Poznań",
    area: inputs.area,
    wr: null,
    inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    propertyRight: "wlasnosc_lokalu",
    kwNumber: null,
    client: null,
    inspectionDate: null,
    ownerId: "o1",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
}

const b18 = (inputs: KcsInput) =>
  approvalBlockers(draftOf(inputs), {}).filter((b) => b.code === "B-18");

/** Komplet ocen dla każdego lokalu skrajnego fikstury — pierwszy opisany poziom każdej cechy. */
function fullRatings(inputs: KcsInput): NonNullable<KcsInput["comparableRatings"]> {
  const out: NonNullable<KcsInput["comparableRatings"]> = {};
  for (const lokal of extremeLokale(inputs)) {
    out[lokal.key] = Object.fromEntries(
      inputs.features
        .filter((f) => f.weight > 0 && f.key)
        .map((f) => [f.key!, f.definitions?.gorsza ? "gorsza" : "lepsza"]),
    );
  }
  return out;
}

describe("B-18 — oceny lokali o cenie skrajnej", () => {
  it("bez ocen: jeden bloker na każdy lokal skrajny × cechę aktywną, ścieżka prowadzi po kluczu lokalu i cechy", () => {
    const { inputs } = wycena1409Anon();
    const blockers = b18(inputs);
    // 3 lokale (Cmax + remis Cmin) × 6 cech aktywnych.
    expect(blockers).toHaveLength(18);
    expect(blockers[0]).toEqual({
      code: "B-18",
      path: "comparableRatings[TEST-TX-12|TEST-LOK-12].standard-wykonczenia",
      label: "Oceń cechę „Standard wykończenia” lokalu o cenie najwyższej w próbie (krok 4).",
    });
    expect(blockers.some((b) => b.label.includes("najniższej"))).toBe(true);
  });

  it("komplet ocen na opisanych poziomach → zero blokerów B-18", () => {
    const { inputs } = wycena1409Anon();
    inputs.comparableRatings = fullRatings(inputs);
    expect(b18(inputs)).toEqual([]);
  });

  it("ocena na nieopisanym poziomie blokuje jak brak oceny (ADR-016 reg. 4)", () => {
    const { inputs } = wycena1409Anon();
    const ratings = fullRatings(inputs);
    ratings["TEST-TX-12|TEST-LOK-12"]["pomieszczenia-przynalezne"] = "przecietna";
    inputs.comparableRatings = ratings;
    expect(b18(inputs).map((b) => b.path)).toEqual([
      "comparableRatings[TEST-TX-12|TEST-LOK-12].pomieszczenia-przynalezne",
    ]);
  });

  /**
   * Finding F2 z review PR #79: cecha MIERZALNA z nieopisanym poziomem to
   * przypadek, w którym §12.2 ma dokąd spaść (na progi), więc brak testu
   * pozwalał bramce milczeć. `powierzchnia-uzytkowa` fikstury ma progi
   * (mediana 44 m²) i tylko dwa opisane poziomy — „przecietna” jest tam
   * poziomem nieopisanym, a mimo progów musi blokować.
   */
  it("ocena na nieopisanym poziomie cechy Z PROGAMI też blokuje (F2)", () => {
    const { inputs } = wycena1409Anon();
    const powierzchnia = inputs.features.find((f) => f.key === "powierzchnia-uzytkowa")!;
    expect(powierzchnia.measure).not.toBeNull();
    expect(powierzchnia.definitions?.przecietna ?? "").toBe("");

    const ratings = fullRatings(inputs);
    ratings["TEST-TX-12|TEST-LOK-12"]["powierzchnia-uzytkowa"] = "przecietna";
    inputs.comparableRatings = ratings;
    expect(b18(inputs).map((b) => b.path)).toEqual([
      "comparableRatings[TEST-TX-12|TEST-LOK-12].powierzchnia-uzytkowa",
    ]);
  });

  it("cecha z wagą 0 nie wymaga oceny", () => {
    const { inputs } = wycena1409Anon();
    inputs.comparableRatings = fullRatings(inputs);
    inputs.features.push({
      name: "Liczba izb",
      weight: 0,
      rating: null,
      key: "liczba-izb",
      definitions: { lepsza: "a", gorsza: "b" },
    });
    expect(b18(inputs)).toEqual([]);
  });

  it("bez migawki próby (sampleSelection null) bramka milczy — blokuje wtedy próba", () => {
    const { inputs } = wycena1409Anon();
    inputs.sampleSelection = null;
    expect(b18(inputs)).toEqual([]);
  });

  it("szkic bez inputs nie wywraca bramki", () => {
    const v = { ...draftOf(wycena1409Anon().inputs), inputs: null };
    expect(approvalBlockers(v, {}).filter((b) => b.code === "B-18")).toEqual([]);
  });
});
