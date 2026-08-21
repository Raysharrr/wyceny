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
describe("renderOperatDocx — Table 1 obręb (guards docxtemplater's parent-scope fallback, B6)", () => {
  it("prints the ROW's own obręb label, never the subject's §8.2 obręb", () => {
    const input = syntheticDocumentInput({ obreb: "SUBJEKT-OBREB-MARKER-9Q7" });
    input.inputs.comparables = [
      { date: "2026-05-10", area: 50, pricePerM2: 12000, source: "rcn", transactionId: "T1" },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [cand("T1", "306401_1", "0039", 123.4)],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const model = buildDocumentModel(input);
    // Sanity on the DATA (already covered by document-model-table1.test.ts):
    // §8.2 uses the subject's own obręb, Table 1's row uses the candidate's.
    expect(model.obreb).toBe("SUBJEKT-OBREB-MARKER-9Q7");
    expect(model.transakcje[0].obreb).toBe("0039 Łazarz");

    const text = docText(renderOperatDocx(model));

    // The subject's own §8.2 marker prints EXACTLY once — if the loop's
    // `{obreb}` fell back to the parent scope, it would print a SECOND time
    // inside Table 1 (once per row).
    const subjectOccurrences = (text.match(/SUBJEKT-OBREB-MARKER-9Q7/g) ?? []).length;
    expect(subjectOccurrences).toBe(1);
    // And the row's own obręb prints for real, in the actual rendered document.
    expect(text).toContain("0039 Łazarz");
  });
});
