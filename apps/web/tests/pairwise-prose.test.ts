import { describe, it, expect } from "vitest";
import { buildProseFacts } from "../src/domain/prose";
import { currentSectionFactsHashes } from "../src/domain/prose-hash";
import { computeValuation } from "../src/domain/valuation-calculation";
import { pairwiseReference } from "./fixtures/pairwise-document-fixture";
import { goldenInputs } from "./fixtures/document-model-fixture";
const address = "ul. Testowa 1, Nowogród";
describe("PP prose dependencies", () => {
  it("uses only selected rows and supplies method facts without WR", () => {
    const inputs = pairwiseReference("a");
    inputs.comparables.push({ id: "retained", pricePerM2: 0 });
    const facts = buildProseFacts({ address, inputs });
    expect(facts.proba?.liczba_transakcji).toBe(3);
    expect(facts.metoda).toBe("porównywania parami");
    expect(facts.poprawki_porownan?.length).toBeGreaterThan(0);
    expect(JSON.stringify(facts)).not.toContain("740900");
  });
  it("invalidates only justification for changed corrections with the same rounded WR", () => {
    const inputs = pairwiseReference("a");
    const before = currentSectionFactsHashes({ address, inputs });
    const wr = computeValuation(inputs).wr;
    inputs.pairwise!.comparisons[inputs.pairwise!.selectedComparableIds[0]][
      inputs.features[0].key!
    ].multiplier = 0.0001;
    inputs.pairwise!.comparisons[inputs.pairwise!.selectedComparableIds[0]][
      inputs.features[0].key!
    ].overrideReason = "Drobna korekta rzeczoznawcy";
    expect(computeValuation(inputs).wr).toBe(wr);
    const after = currentSectionFactsHashes({ address, inputs });
    expect(
      Object.keys(before).filter(
        (k) => before[k as keyof typeof before] !== after[k as keyof typeof after],
      ),
    ).toEqual(["uzasadnienie"]);
  });
  it("keeps legacy and explicitly selected KCS hashes identical", () => {
    const inputs = goldenInputs();
    expect(currentSectionFactsHashes({ address, inputs })).toEqual(
      currentSectionFactsHashes({
        address,
        inputs: { ...inputs, method: "kcs", methodConfirmed: true },
      }),
    );
  });
  it("allows incomplete PP descriptions without inventing a sample", () => {
    const inputs = pairwiseReference("a");
    inputs.pairwise!.selectedComparableIds = [];
    expect(buildProseFacts({ address, inputs }).proba).toBeUndefined();
    expect(() => currentSectionFactsHashes({ address, inputs })).not.toThrow();
  });
});

it("preserves hashes captured from original 9b2903c prose/hash source", async () => {
  const fs = await import("node:fs");
  const baseline = JSON.parse(
    fs.readFileSync("../../tools/spike/2026-09-13-legacy-render/baseline.json", "utf8"),
  );
  const expected = JSON.parse(fs.readFileSync("tests/fixtures/legacy-prose-hashes.json", "utf8"));
  const input = {
    address: baseline.records[0].input.address,
    inputs: baseline.records[0].input.inputs,
  };
  expect(currentSectionFactsHashes(input)).toEqual(expected.hashes);
});

it.each(["multiplier", "rating"] as const)(
  "omits a retained reason when %s returns the cell to today's suggestion",
  (change) => {
    const inputs = pairwiseReference("a");
    const f = inputs.features[0];
    const cell = inputs.pairwise!.comparisons[inputs.pairwise!.selectedComparableIds[0]][f.key!];
    cell.rating = "lepsza";
    cell.multiplier = change === "rating" ? 0 : -0.25;
    cell.overrideReason = "RETAINED EXCEPTION REASON";
    const facts = () => buildProseFacts({ address, inputs }).poprawki_porownan!.join("\n");
    expect(facts()).toContain("RETAINED EXCEPTION REASON");
    if (change === "multiplier") cell.multiplier = -0.5;
    else cell.rating = "przecietna";
    expect(facts()).not.toContain("RETAINED EXCEPTION REASON");
    expect(cell.overrideReason).toBe("RETAINED EXCEPTION REASON");
    expect(facts()).toContain("waga 40%");
    expect(facts()).not.toContain("40,00%");
  },
);
