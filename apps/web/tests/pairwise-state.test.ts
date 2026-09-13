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

it.each(["rcn", "rejestr_sm"] as const)(
  "does not demote a %s row when its stable id survives a price edit and source-id stripping",
  (source) => {
    const inputs = ppInputs();
    const original = {
      ...inputs.comparables[0],
      source,
      coopTxId: source === "rejestr_sm" ? "coop-tx" : undefined,
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
      source,
      status: "to_verify",
      id: original.id,
    });
  },
);

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

import { approvalGate } from "../src/domain/provenance";
it("approval checks provenance only for selected PP comparables and refuses a changed confirmed basis", () => {
  const inputs = ppInputs();
  inputs.provenance = {
    address: { source: "rzeczoznawca", status: "confirmed" },
    area: { source: "rzeczoznawca", status: "confirmed" },
    ...provenance,
  };
  inputs.comparables.push({
    id: "00000000-0000-4000-8000-000000000099",
    source: "manual",
    status: "to_verify",
    pricePerM2: 12000,
  });
  inputs.pairwise!.confirmedBasis = pairwiseBasis(inputs);
  expect(approvalGate(inputs)).toEqual({ ok: true });
  inputs.comparables[0].status = "to_verify";
  expect(approvalGate(inputs)).toMatchObject({
    ok: false,
    blockers: expect.arrayContaining([expect.objectContaining({ path: "comparables[0]" })]),
  });
  inputs.comparables[0].status = "confirmed";
  inputs.comparables[0].pricePerM2 += 1;
  expect(approvalGate(inputs)).toMatchObject({
    ok: false,
    blockers: expect.arrayContaining([
      expect.objectContaining({ path: "pairwise.confirmedBasis" }),
    ]),
  });
});

import { approveValuation } from "../src/domain/valuation";
import type { ValuationInput } from "../src/domain/valuation-input";
describe("review regressions: approval completeness and canonical rows", () => {
  it.each([
    "missing area",
    "missing features",
    "unknown method",
    "unknown method and missing area",
  ])("refuses %s at the gate and aggregate", (variant) => {
    const v = draft();
    expect(approvalGate(v.inputs!)).toEqual({ ok: true });
    const incomplete: Partial<ValuationInput> = { ...v.inputs! };
    if (variant.includes("missing area")) delete incomplete.area;
    if (variant.includes("missing features")) delete incomplete.features;
    if (variant.includes("unknown method")) incomplete.method = "unknown" as never;
    expect(approvalGate(incomplete as ValuationInput).ok).toBe(false);
    expect(() =>
      approveValuation({ ...v, inputs: incomplete as ValuationInput }, new Date()),
    ).toThrow();
    expect(v.status).toBe("in_progress");
  });
  it("preserves an incoming SM identity when a stored row was previously classified as RCN", () => {
    const inputs = ppInputs();
    inputs.comparables[0] = {
      ...inputs.comparables[0],
      source: "rcn",
      transactionId: "tx",
      lokalId: "a",
    };
    const ids = inputs.comparables.map((c) => comparableIdentity(c)!);
    inputs.pairwise = {
      selectedComparableIds: ids,
      comparisons: Object.fromEntries(
        ids.map((id) => [id, { inne: { rating: "lepsza", multiplier: 0 } }]),
      ),
    };
    const incoming = assignSampleProvenance({
      comparables: inputs.comparables.map((c, i) => (i === 0 ? { ...c, coopTxId: "coop-tx" } : c)),
    });
    expect(incoming[0].source).toBe("rejestr_sm");
    const updated = applySampleUpdate(
      { ...draft(), inputs },
      { comparables: incoming, sampleMeta: null },
    );
    expect(updated.inputs!.comparables[0].source).toBe("rejestr_sm");
    expect(comparableIdentity(updated.inputs!.comparables[0])).toBe("sm:coop-tx");
    expect(updated.inputs!.pairwise!.selectedComparableIds).not.toContain(ids[0]);
    expect(updated.inputs!.pairwise!.comparisons[ids[0]]).toBeUndefined();
  });
  it("ties PP provenance blockers to the saved pool even when selected display order differs", () => {
    const inputs = ppInputs();
    inputs.provenance = {
      address: { source: "rzeczoznawca", status: "confirmed" },
      area: { source: "rzeczoznawca", status: "confirmed" },
      ...provenance,
    };
    inputs.pairwise!.selectedComparableIds = inputs.pairwise!.selectedComparableIds.toReversed();
    inputs.comparables[2].status = "to_verify";
    inputs.pairwise!.confirmedBasis = pairwiseBasis(inputs);
    expect(approvalGate(inputs)).toEqual({
      ok: false,
      blockers: [
        { path: "comparables[2]", label: expect.stringContaining("Transakcja 3 w zapisanej puli") },
      ],
    });
  });
  it("refuses an explicit stale selection after source identity normalization without changing the draft", () => {
    const inputs = ppInputs();
    const before = structuredClone(inputs);
    const incoming = assignSampleProvenance({
      comparables: inputs.comparables.map((c, i) =>
        i === 0 ? { ...c, transactionId: "tx", lokalId: "a" } : c,
      ),
    });
    expect(() =>
      applySampleUpdate(
        { ...draft(), inputs },
        {
          comparables: incoming,
          sampleMeta: null,
          selectedComparableIds: inputs.pairwise!.selectedComparableIds,
        },
      ),
    ).toThrow(/Wybierz ponownie/);
    expect(inputs).toEqual(before);
  });
});
