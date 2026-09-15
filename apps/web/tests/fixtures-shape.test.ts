import { describe, expect, it } from "vitest";
import { computeKcs } from "../src/domain/kcs";
import { PROSE_SECTIONS } from "../src/domain/prose-snapshot";
import { currentSectionFactsHash } from "../src/domain/prose-hash";
import { INSPECTION_SECTIONS } from "../src/domain/inspection";
import { valuationFormSchema } from "../src/lib/valuation-form-schema";
import { buildDocumentModel } from "../src/domain/document-model";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { expectNoText, openDocx, sectionText } from "./support/docx-invariants";
import {
  KW_TESTOWA,
  OCZEKIWANE_PO_ADR016,
  PIETRO_PRZEDMIOTU,
  formValuesOf,
  wycena1409Anon,
} from "./fixtures/wycena-1409-anon";

/**
 * Kształt fikstury zanonimizowanej (plan operat-bugfix §P1.4 TF.2, spec §7.2): przechodzi
 * dzisiejszy `valuationFormSchema` i niesie każdy przypadek paczki 1 — asercje po polach,
 * żeby sesje paczki mogły na niej pisać testy bez sprawdzania, czy przypadek w ogóle jest.
 */

const feature = (v: ReturnType<typeof wycena1409Anon>, key: string) => {
  const f = v.inputs.features.find((x) => x.key === key);
  if (!f) throw new Error(`brak cechy ${key}`);
  return f;
};
const describedLevels = (f: { definitions?: Partial<Record<string, string>> | null }) =>
  Object.entries(f.definitions ?? {})
    .filter(([, text]) => (text ?? "").trim() !== "")
    .map(([level]) => level)
    .sort();

describe("fikstura wycena-1409-anon — schemat formularza", () => {
  const VARIANTS = [
    { skalaPowierzchni: "jak_zgloszono", kw: "brak" },
    { skalaPowierzchni: "jak_zgloszono", kw: "odpis_z_wpisem_dzial_iii" },
    { skalaPowierzchni: "poprawiona", kw: "brak" },
    { skalaPowierzchni: "poprawiona", kw: "odpis_z_wpisem_dzial_iii" },
  ] as const;

  for (const variant of VARIANTS) {
    it(`przechodzi valuationFormSchema bez zgubionych pól (${variant.skalaPowierzchni}, ${variant.kw})`, () => {
      const values = formValuesOf(wycena1409Anon(variant));
      const parsed = valuationFormSchema.safeParse(values);
      expect(parsed.error?.issues).toBeUndefined();
      // Równość, nie samo `success`: zod po cichu obcina nieznane klucze, więc pole spoza
      // schematu przeszłoby walidację, a nie dotarło do aplikacji.
      expect(parsed.data).toEqual(values);
    });
  }

  it("wynik KCS fikstury jest policzony z jej własnych danych", () => {
    for (const variant of VARIANTS) {
      const v = wycena1409Anon(variant);
      expect(v.kcs).toEqual(computeKcs(v.inputs));
    }
  });

  it("renderuje się przez prawdziwy szablon (warstwa docx-invariants)", () => {
    for (const variant of VARIANTS) {
      const doc = openDocx(renderOperatDocx(buildDocumentModel(wycena1409Anon(variant))));
      expect(sectionText(doc, "12.3.")).toContain("powierzchnia użytkowa");
      expectNoText(doc, "undefined");
    }
  });
});

describe("fikstura wycena-1409-anon — przypadki paczki 1", () => {
  const reported = wycena1409Anon();
  const corrected = wycena1409Anon({ skalaPowierzchni: "poprawiona" });

  it("cechy i wagi jak w kroku 4 wyceny 14.09", () => {
    expect(reported.inputs.features.map((f) => [f.key, f.weight])).toEqual([
      ["standard-wykonczenia", 0.4],
      ["polozenie-na-pietrze", 0.3],
      ["lokalizacja", 0.1],
      ["powierzchnia-uzytkowa", 0.1],
      ["pomieszczenia-przynalezne", 0.04],
      ["dodatkowe", 0.06],
    ]);
  });

  it("lokalizacja: opisane lepsza i przeciętna, ocena przeciętna", () => {
    const f = feature(reported, "lokalizacja");
    expect(describedLevels(f)).toEqual(["lepsza", "przecietna"]);
    expect(f.rating).toBe("przecietna");
  });

  it("powierzchnia jak zgłoszono: opisane lepsza i gorsza, ocena na nieopisanym poziomie", () => {
    const f = feature(reported, "powierzchnia-uzytkowa");
    expect(describedLevels(f)).toEqual(["gorsza", "lepsza"]);
    expect(f.rating).toBe("przecietna");
    expect(describedLevels(f)).not.toContain(f.rating);
  });

  it("powierzchnia poprawiona jak u Anety: trzy opisane poziomy, ocena przeciętna; reszta cech bez zmian", () => {
    const f = feature(corrected, "powierzchnia-uzytkowa");
    expect(describedLevels(f)).toEqual(["gorsza", "lepsza", "przecietna"]);
    expect(f.rating).toBe("przecietna");
    const others = (v: typeof reported) =>
      v.inputs.features.filter((x) => x.key !== "powierzchnia-uzytkowa");
    expect(others(corrected)).toEqual(others(reported));
  });

  it("oczekiwanie po ADR-016 = suma Ui zaokrąglonych per wiersz na danych fikstury", () => {
    // Liczone niezależnie od silnika: pozycje wg ADR-016 (lokalizacja → min, powierzchnia z
    // trzema poziomami → środek), każdy Ui do 3 miejsc, potem suma — reguła z 15.09.
    const { kcs, inputs } = corrected;
    const position: Record<string, "min" | "mid" | "max"> = {
      "standard-wykonczenia": "mid",
      "polozenie-na-pietrze": "max",
      lokalizacja: "min",
      "powierzchnia-uzytkowa": "mid",
      "pomieszczenia-przynalezne": "min",
      dodatkowe: "min",
    };
    const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
    const rows = inputs.features.map((f) => {
      const p = position[f.key!];
      return round(p === "mid" ? f.weight : f.weight * (p === "min" ? kcs.vmin : kcs.vmax), 3);
    });
    const sumUi = round(
      rows.reduce((a, b) => a + b, 0),
      3,
    );
    const wr = Math.round(round(round(kcs.csr * sumUi, 2) * inputs.area, 2) / 100) * 100;
    expect({ sumUi, wr }).toEqual(OCZEKIWANE_PO_ADR016);
    // Dzisiejszy silnik (suma zaokrąglana raz) daje na tych danych mniej — rozjazd jak w 14.09.
    const raw = inputs.features.reduce((sum, f) => {
      const p = position[f.key!];
      return sum + (p === "mid" ? f.weight : f.weight * (p === "min" ? kcs.vmin : kcs.vmax));
    }, 0);
    expect(round(raw, 3)).toBe(1.019);
  });

  it("piętro i powierzchnia przedmiotu", () => {
    expect(reported.area).toBe(44.2);
    expect(reported.inputs.area).toBe(44.2);
    expect(PIETRO_PRZEDMIOTU).toBe(6);
  });

  it("transakcje próby mają piętro, powierzchnię i ulicę; porównania = próba", () => {
    const proposed = reported.inputs.sampleSelection!.proposed;
    expect(proposed.length).toBeGreaterThanOrEqual(12);
    for (const c of proposed) {
      expect(typeof c.floor).toBe("number");
      expect(c.area).toBeGreaterThan(0);
      expect(c.street?.trim()).toBeTruthy();
    }
    expect(
      reported.inputs.comparables.map((c) => [c.transactionId, c.lokalId, c.pricePerM2, c.area]),
    ).toEqual(proposed.map((c) => [c.transactionId, c.lokalId, c.pricePerM2, c.area]));
  });

  it("remis Cmin: dwie transakcje o tej samej najniższej cenie jednostkowej", () => {
    const prices = reported.inputs.comparables.map((c) => c.pricePerM2);
    const min = Math.min(...prices);
    expect(prices.filter((p) => p === min)).toHaveLength(2);
    expect(reported.kcs.cmin).toBe(min);
    expect(prices.filter((p) => p === Math.max(...prices))).toHaveLength(1);
  });

  it("wariant kw = null: bez snapshotu KW, numer wpisany ręcznie", () => {
    expect(reported.inputs.kw).toBeNull();
    expect(reported.kwNumber).toBe(KW_TESTOWA);
    expect(KW_TESTOWA).toMatch(/^[A-Z]{2}\d[A-Z]\/\d{8}\/\d$/);
  });

  it("wariant KW z uploadu (odpis_kw) z wpisem w dziale III", () => {
    const kw = wycena1409Anon({ kw: "odpis_z_wpisem_dzial_iii" }).inputs.kw!;
    expect(kw.source).toBe("odpis_kw");
    expect(kw.kwLokalu).toBe(KW_TESTOWA);
    expect(kw.dzial3?.wpisy).toBe(true);
    expect(kw.dzial3?.tresc.length).toBeGreaterThan(0);
  });

  it("kategoria zdjęć bez zdjęcia obok kategorii ze zdjęciami", () => {
    const photos = reported.inputs.inspection!.photos;
    const counts = INSPECTION_SECTIONS.map((s) => photos[s].length);
    expect(counts.filter((n) => n === 0)).toHaveLength(1);
    expect(counts.filter((n) => n > 0).length).toBeGreaterThan(0);
  });

  it("proza gotowa w inputs.prose: sześć sekcji potwierdzonych, aktualnych wobec danych", () => {
    for (const v of [reported, wycena1409Anon({ kw: "odpis_z_wpisem_dzial_iii" })]) {
      const prose = v.inputs.prose!;
      for (const section of PROSE_SECTIONS) {
        expect(prose.sections[section]?.value.trim()).toBeTruthy();
        expect(prose.sections[section]?.provenance).toEqual({
          source: "rzeczoznawca",
          status: "confirmed",
        });
        expect(prose.factsHashes[section]).toBe(
          currentSectionFactsHash(section, { address: v.address, inputs: v.inputs }),
        );
      }
    }
  });

  it("wartości fikcyjne: adres „ul. Testowa”, brak ciągów w kształcie PESEL", () => {
    expect(reported.address).toContain("ul. Testowa");
    const json = JSON.stringify([reported, wycena1409Anon({ kw: "odpis_z_wpisem_dzial_iii" })]);
    expect(json).not.toMatch(/\b\d{11}\b/);
  });
});
