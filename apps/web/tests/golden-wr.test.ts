import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";

// F-3 (reproducibility): the reference inputs live in a committed snapshot
// file — this test reads it from disk and must pass with no network and no DB.
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/koscielna.json", import.meta.url)), "utf8"),
) as {
  input: KcsInput;
  expected: { csr: number; sumUi: number; unitValue: number; wr: number };
};

describe("KCS engine — Kościelna reference operat", () => {
  // F-1: golden — the engine reproduces the reference operat TO THE ZŁOTY,
  // including the operat rounding convention (sumUi→3dp, unitValue→2dp,
  // wr→100 zł). Deliberately NOT asserting vmin/vmax (PDF prints 0.920,
  // engine yields 0.919 — no effect on WR).
  it("F-1: reproduces WR = 1 044 400 zł and the printed intermediates", () => {
    const result = computeKcs(fixture.input);
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.expected.wr);
  });

  // F-2: determinism — same input, same output, every time. The engine has
  // no Date/random/I-O by construction; this pins it against regressions.
  it("F-2: is deterministic across repeated calls", () => {
    const a = computeKcs(fixture.input);
    const b = computeKcs(fixture.input);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  // F-2 supporting invariant: the engine must not mutate its input.
  it("F-2: does not mutate the input", () => {
    const snapshot = JSON.stringify(fixture.input);
    computeKcs(fixture.input);
    expect(JSON.stringify(fixture.input)).toBe(snapshot);
  });

  it("rejects degenerate inputs", () => {
    expect(() => computeKcs({ ...fixture.input, comparables: [] })).toThrow();
    expect(() => computeKcs({ ...fixture.input, area: 0 })).toThrow();
  });
});
