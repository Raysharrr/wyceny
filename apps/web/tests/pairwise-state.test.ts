import { describe, it, expect } from "vitest";
import {
  applyCalculationConfirm,
  applyFeaturesUpdate,
  applySampleUpdate,
  applyMethodSelection,
  newVersionOf,
} from "../src/domain/valuation";
import { pairwiseBasis } from "../src/domain/pairwise-state";
import { approvableInput } from "./fixtures/valuation-inputs";
import type { Valuation } from "../src/ports/valuation";
const draft = (): Valuation =>
  ({
    ...approvableInput("pairwise-owner"),
    id: "pairwise-test",
    status: "in_progress",
    inputs: { ...approvableInput("pairwise-owner").inputs!, method: "kcs", methodConfirmed: true },
  }) as Valuation;
describe("S2 atomic pairwise state", () => {
  it("refuses KCS below twelve and unconfirmed PP", () => {
    const v = draft();
    v.inputs!.comparables = v.inputs!.comparables.slice(0, 11);
    expect(() => applyCalculationConfirm(v)).toThrow();
    v.inputs!.method = "pp";
    expect(() => applyCalculationConfirm(v)).toThrow();
  });
  it("preserves legacy KCS calculation when explicitly selecting the same method", () => {
    const v = draft();
    delete v.inputs!.method;
    delete v.inputs!.methodConfirmed;
    expect(applyMethodSelection(v, { method: "kcs", confirm: true })).toMatchObject({
      wr: v.wr,
      inputs: { method: "kcs", methodConfirmed: true },
    });
    expect(applyMethodSelection(v, { method: "pp", confirm: true }).wr).toBeNull();
  });
  it("rejects a stale features form after sample changes and retains the newer sample", () => {
    const v = draft();
    v.inputs!.method = "pp";
    const basis = pairwiseBasis(v.inputs!);
    const changed = applySampleUpdate(v, {
      comparables: v.inputs!.comparables,
      sampleMeta: null,
      selectedComparableIds: [],
    });
    changed.inputs!.area += 1;
    expect(() =>
      applyFeaturesUpdate(changed, {
        features: v.inputs!.features,
        provenance: {
          weights: { source: "rzeczoznawca", status: "confirmed" },
          ratings: { source: "rzeczoznawca", status: "confirmed" },
        },
        comparisons: {},
        confirmPairwise: true,
        expectedPairwiseBasis: basis,
      }),
    ).toThrow(/zmieni/);
  });
  it("clears confirmation and WR in a new version, retains proposed method", () => {
    const v = draft();
    v.status = "signed";
    v.inputs!.pairwise = { selectedComparableIds: [], comparisons: {}, confirmedBasis: "old" };
    expect(newVersionOf(v)).toMatchObject({
      wr: null,
      inputs: { method: "kcs", methodConfirmed: false },
    });
    expect(newVersionOf(v).inputs!.pairwise!.confirmedBasis).toBeUndefined();
  });
  it("refuses signed sample edits", () => {
    const v = draft();
    v.status = "signed";
    expect(() => applySampleUpdate(v, { comparables: [], sampleMeta: null })).toThrow();
  });
});

import { comparableIdentity } from "../src/domain/pairwise-state";
import { assignSampleProvenance } from "../src/lib/assign-provenance";
import { ppInputs } from "./fixtures/pairwise-inputs";
const provenance = {
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
} as const;
describe("S2 identity and confirmation", () => {
  it("confirms the resulting edited snapshot and preserves basis through JSON round-trip", () => {
    const v = { ...draft(), inputs: ppInputs() };
    const updated = applyFeaturesUpdate(v, {
      features: v.inputs.features,
      provenance,
      comparisons: v.inputs.pairwise!.comparisons,
      expectedPairwiseBasis: pairwiseBasis(v.inputs),
      confirmPairwise: true,
    });
    const persisted = JSON.parse(JSON.stringify(updated.inputs));
    expect(persisted.pairwise.confirmedBasis).toBe(pairwiseBasis(persisted));
    expect(applyCalculationConfirm({ ...updated, inputs: persisted }).wr).toBe(505000);
  });
  it("reorder/remove/add never transfers ratings by index, including two locals of one act", () => {
    const inputs = ppInputs();
    inputs.comparables[0] = {
      ...inputs.comparables[0],
      source: "rcn",
      transactionId: "tx",
      lokalId: "a",
    };
    inputs.comparables[1] = {
      ...inputs.comparables[1],
      source: "rcn",
      transactionId: "tx",
      lokalId: "b",
    };
    const [a, b, c] = inputs.comparables;
    const ids = inputs.comparables.map((c) => comparableIdentity(c)!);
    inputs.pairwise = {
      selectedComparableIds: ids,
      comparisons: {
        [ids[0]]: { inne: { rating: "lepsza", multiplier: 0 } },
        [ids[1]]: { inne: { rating: "gorsza", multiplier: 1 } },
      },
    };
    const v = { ...draft(), inputs };
    const reordered = applySampleUpdate(v, {
      comparables: [b, c, a],
      sampleMeta: null,
      selectedComparableIds: [ids[1], ids[2], ids[0]],
    });
    expect(reordered.inputs!.pairwise!.comparisons).toEqual(inputs.pairwise.comparisons);
    const added = { ...c, id: "00000000-0000-4000-8000-000000000099" };
    const edited = applySampleUpdate(reordered, { comparables: [c, added, b], sampleMeta: null });
    expect(edited.inputs!.pairwise!.comparisons[ids[0]]).toBeUndefined();
    expect(edited.inputs!.pairwise!.comparisons[comparableIdentity(added)!]).toBeUndefined();
    expect(edited.inputs!.pairwise!.comparisons[ids[1]].inne.rating).toBe("gorsza");
  });
  it.each(["promotion", "missing-local"])(
    "requires reassessment when canonical identity changes: %s",
    (kind) => {
      const inputs = ppInputs();
      if (kind === "missing-local")
        inputs.comparables[0] = { ...inputs.comparables[0], source: "rcn", transactionId: "tx" };
      const oldId = comparableIdentity(inputs.comparables[0])!;
      inputs.pairwise = {
        selectedComparableIds: [oldId],
        comparisons: { [oldId]: { inne: { rating: "lepsza", multiplier: 0 } } },
      };
      const incoming = assignSampleProvenance({
        comparables: inputs.comparables.map((c, i) =>
          i === 0 ? { ...c, transactionId: "tx", lokalId: "a" } : c,
        ),
      });
      const updated = applySampleUpdate(
        { ...draft(), inputs },
        { comparables: incoming, sampleMeta: null },
      );
      expect(updated.inputs!.pairwise!.selectedComparableIds).not.toContain(oldId);
      expect(updated.inputs!.pairwise!.comparisons[oldId]).toBeUndefined();
      expect(updated.inputs!.comparables[0].pricePerM2).toBe(inputs.comparables[0].pricePerM2);
    },
  );
  it("rejects malformed scales and an unexplained override before stamping", () => {
    const v = { ...draft(), inputs: ppInputs() };
    const comparisons = structuredClone(v.inputs.pairwise!.comparisons);
    comparisons[v.inputs.pairwise!.selectedComparableIds[0]].inne.multiplier = -0.25;
    expect(() =>
      applyFeaturesUpdate(v, {
        features: v.inputs.features,
        provenance,
        comparisons,
        expectedPairwiseBasis: pairwiseBasis(v.inputs),
        confirmPairwise: true,
      }),
    ).toThrow();
    expect(v.inputs.pairwise!.confirmedBasis).toBeUndefined();
  });
});

it("does not demote a registry row when its stable id survives a price edit and source-id stripping", () => {
  const inputs = ppInputs();
  const original = {
    ...inputs.comparables[0],
    source: "rcn" as const,
    transactionId: "tx",
    lokalId: "a",
  };
  inputs.comparables[0] = original;
  const incoming = {
    id: original.id,
    source: "manual" as const,
    status: "confirmed" as const,
    pricePerM2: original.pricePerM2 + 20,
  };
  const updated = applySampleUpdate(
    { ...draft(), inputs },
    { comparables: [incoming, ...inputs.comparables.slice(1)], sampleMeta: null },
  );
  expect(updated.inputs!.comparables[0]).toMatchObject({
    source: "rcn",
    status: "to_verify",
    id: original.id,
  });
});

import { currentSectionFactsHashes } from "../src/domain/prose-hash";
it("same-method legacy confirmation preserves prose fingerprints and refuses immutable records", () => {
  const v = draft();
  delete v.inputs!.method;
  delete v.inputs!.methodConfirmed;
  const hashes = currentSectionFactsHashes({ address: v.address, inputs: v.inputs! });
  const selected = applyMethodSelection(v, { method: "kcs", confirm: true });
  expect(
    currentSectionFactsHashes({ address: selected.address, inputs: selected.inputs! }),
  ).toEqual(hashes);
  for (const status of ["approved", "signed"] as const)
    expect(() => applyMethodSelection({ ...v, status }, { method: "pp", confirm: true })).toThrow(
      /not a draft/,
    );
});
