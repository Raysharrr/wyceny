import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { buildDocumentModel } from "../src/domain/document-model";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
import type { Candidate } from "../src/domain/sample-selection";

function docText(docx: Buffer): string {
  return new PizZip(docx).files["word/document.xml"]
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ");
}

const cand = (id: string, teryt: string, obreb: string, distanceM: number): Candidate => ({
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
});

/**
 * Final wave B6 — guards docxtemplater's own PARENT-SCOPE FALLBACK, one
 * floor below `document-model-table1.test.ts` (which only checks
 * `buildDocumentModel`'s DATA, never renders). Table 1's `{obreb}` sits
 * INSIDE `{#transakcje}`, while the SAME tag name `{obreb}` also appears at
 * the top level (§8.2, the subject's own EGiB block) — docxtemplater scopes
 * tags per loop, but if a loop item ever failed to carry its own `obreb`
 * key, the engine falls back to the PARENT scope silently (no error),
 * printing the subject's obręb for every comparable row instead. Rendered
 * through the REAL template with the REAL renderer (same options as
 * `adapters/docx-render.ts`), not a mock — the only way to catch a
 * fallback that a pure data-model test can't see.
 */
describe("renderOperatDocx — Table 1 city/street (guards docxtemplater's parent-scope fallback, B6)", () => {
  it("prints the ROW's own city and street, never the subject's address", () => {
    // docxtemplater scopes tags per loop, but a loop item missing a key falls back to the
    // PARENT scope SILENTLY — which is how the subject's address ended up in every row
    // before (Łukasz: "wszystkie z Heweliusza 3/43"). Slice 3d puts {miasto}/{ulica} back
    // into Table 1, so that trap is live again and this renders the REAL template to
    // catch it. `DocumentModel` deliberately has no top-level `miasto`/`ulica`.
    const input = syntheticDocumentInput();
    input.address = "ul. Przedmiotowa 1, MIASTOMARKER9Q7";
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "T1",
        lokalId: "306401_1.0039.x",
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [
        {
          ...cand("T1", "306401_1", "0039", 123.4),
          street: "ul. Kościelna",
          streetNumber: "33A",
          city: "Luboń",
        },
      ],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const model = buildDocumentModel(input);
    expect(model.transakcje[0]).toMatchObject({ miasto: "Luboń", ulica: "Kościelna" });

    const text = docText(renderOperatDocx(model));
    const table1 = text.slice(text.indexOf("Tabela 1"), text.indexOf("Tabela 2"));

    expect(table1).toContain("Luboń");
    expect(table1).toContain("Kościelna");
    // The subject's city must not appear inside Table 1 — that IS the parent-scope leak.
    expect(table1).not.toContain("MIASTOMARKER9Q7");
    // And the house number stays out of the document entirely (F-12).
    expect(text).not.toContain("33A");
  });
});
