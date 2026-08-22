// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { sampleStepSchema } from "@/app/actions/wizard-schemas";
import { candidateKey, type Candidate } from "@/domain/sample-selection";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import {
  matchLegacyRow,
  rcnRow,
  useSampleReview,
} from "../src/app/valuations/[id]/steps/use-sample-review";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — mirrors tests/rtl-step-sample.test.tsx.
afterEach(cleanup);

/**
 * `matchLegacyRow` (wave 4, C1 root cause #2; refined wave 5, wave 6): the
 * pure matching helper `rebuildComparables` falls back to for LEGACY rows
 * (no `lokalId` on the form row — a draft saved before that field
 * existed). Never trusts position.
 *
 * A SINGLE legacy row for a `transactionId` is reused as-is (edits
 * included) ONLY when there's also exactly ONE candidate of that
 * `transactionId` in the effective proposal (`candidatesForTx`) — one row
 * with 2+ candidates of the same act is still ambiguous. Whenever either
 * side has 2+, content (date/area/pricePerM2, rounded like `rcnRow`)
 * decides. The caller (`rebuildComparables`) also CONSUMES a claimed row
 * from a shared pool before the next candidate is checked, so the tests
 * here that model "2 candidates sharing rows" pass the SAME array to both
 * calls but never assert both calls in a way that would hide a
 * double-claim — each assertion below reflects what `rebuildComparables`
 * would actually see call-by-call.
 */
describe("matchLegacyRow", () => {
  const candidate = {
    transactionId: "T1",
    date: "2026-05-10",
    area: 50.634,
    pricePerM2: 7505.428,
  };

  it("matches the single legacy row for this transactionId (one candidate, one row), content identical", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(row.area).toBe("50.63");
    expect(row.pricePerM2).toBe("7505.43");
    expect(matchLegacyRow(candidate, [row], 1)).toBe(row);
  });

  it("a SINGLE legacy row is reused AS-IS even with an EDITED/mismatched price, when it's ALSO the only candidate of that act (wave 5) — a single-lokal act cannot be confused with another lokal", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const edited = { ...row, pricePerM2: "12345" };
    expect(matchLegacyRow(candidate, [edited], 1)).toBe(edited);
  });

  it("a SINGLE legacy row does NOT get the shortcut when 2 candidates share that transactionId (wave 6) — content decides instead, correctly matching the candidate the row actually belongs to", () => {
    const row = rcnRow({ ...candidate, lokalId: "" }); // this row IS candidate's own (unedited) data
    const otherCandidateSameAct = { ...candidate, area: 38.19, pricePerM2: 7541.24 };
    // `candidatesForTx: 2` — the shortcut is disabled; content still
    // correctly places the row with the candidate it matches.
    expect(matchLegacyRow(candidate, [row], 2)).toBe(row);
    // The OTHER candidate of the same act finds nothing in that same
    // single-row pool (content doesn't match) — regenerates, never
    // receives candidate's row.
    expect(matchLegacyRow(otherCandidateSameAct, [row], 2)).toBeUndefined();
  });

  it("2 legacy rows / 2 candidates with DISTINCT content each match their OWN row", () => {
    const candA = { transactionId: "T1", date: "2026-05-10", area: 50.63, pricePerM2: 7505.43 };
    const candB = { transactionId: "T1", date: "2026-05-10", area: 38.19, pricePerM2: 7541.24 };
    const rowA = rcnRow({ ...candA, lokalId: "" });
    const rowB = rcnRow({ ...candB, lokalId: "" });
    expect(matchLegacyRow(candA, [rowA, rowB], 2)).toBe(rowA);
    expect(matchLegacyRow(candB, [rowA, rowB], 2)).toBe(rowB);
  });

  it("2+ legacy rows share one transactionId, one is edited: content matches the candidate whose fresh content it still equals (the UNEDITED row); the EDITED row's own candidate finds nothing and regenerates — accepted trade-off, only for a genuine multi-lokal act", () => {
    const candA = { transactionId: "T1", date: "2026-05-10", area: 50.63, pricePerM2: 7505.43 };
    const candB = { transactionId: "T1", date: "2026-05-10", area: 38.19, pricePerM2: 7541.24 };
    const rowA = rcnRow({ ...candA, lokalId: "" }); // unedited — still matches candA's own content
    const rowBEdited = { ...rcnRow({ ...candB, lokalId: "" }), pricePerM2: "99999" }; // B's row, edited
    // A's candidate finds its own unedited row, unaffected by B's edit.
    expect(matchLegacyRow(candA, [rowA, rowBEdited], 2)).toBe(rowA);
    // B's candidate no longer content-matches its OWN (now edited) row.
    expect(matchLegacyRow(candB, [rowA, rowBEdited], 2)).toBeUndefined();
  });

  it("returns undefined (ambiguous) when 2 legacy rows share transactionId + IDENTICAL content and 2 candidates share it too — never guesses which one, both regenerate", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const rows = [row, { ...row }];
    expect(matchLegacyRow(candidate, rows, 2)).toBeUndefined();
    expect(matchLegacyRow(candidate, rows, 2)).toBeUndefined();
  });

  it("ignores a legacy row for a DIFFERENT transactionId even with identical content — zero rows for THIS transactionId, not one", () => {
    const row = rcnRow({ ...candidate, transactionId: "T-OTHER", lokalId: "" });
    expect(matchLegacyRow(candidate, [row], 1)).toBeUndefined();
  });
});

type FormInput = z.input<typeof sampleStepSchema>;
type ComparableRow = FormInput["comparables"][number];

let n = 0;
/** Mirrors sample-overlay.test.ts's / sample-manual.test.ts's `mk()` — each candidate its own building by default. */
function mk(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  const egib = {
    teryt: "306401_1",
    obreb: "0021",
    arkusz: "10",
    dzialka: "27",
    budynek: String(n),
    lokal: String(n),
  };
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000,
    priceTotal: 600000,
    egib,
    lokalId: `306401_1.0021.AR_10.27.2_BUD.${n}_LOK`,
    distanceM: 100,
    floor: 2,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 0, y: 0 },
    ...over,
  };
}

function makeSel(
  overrides: {
    proposed?: Candidate[];
    alternates?: Candidate[];
    manualRejections?: SampleSelectionSnapshot["manualRejections"];
    manualInclusions?: SampleSelectionSnapshot["manualInclusions"];
    reviewed?: SampleSelectionSnapshot["reviewed"];
  } = {},
): SampleSelectionSnapshot {
  const proposed = overrides.proposed ?? [];
  return {
    version: 3,
    proposed,
    alternates: overrides.alternates ?? [],
    flags: {},
    rejectedCounts: {},
    rejected: [],
    manualRejections: overrides.manualRejections ?? [],
    manualInclusions: overrides.manualInclusions ?? [],
    reviewed: overrides.reviewed ?? [],
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 100, inRadius: 50, afterHygiene: 40, afterBand: 30, proposed: proposed.length },
    params: { subjectArea: 50, todayMonth: "2026-08" },
  };
}

/**
 * Minimal harness for `renderHook` (no full `useFieldArray`, per the Task 2
 * brief: "reuse rebuildComparables przez renderHook z replaceComparables
 * spy") — `sampleSelection` round-trips through a REAL `useForm`/`useWatch`
 * (the hook's own `setValue`/`sel` contract), while `comparables` is plain
 * `useState` behind a `vi.fn()` spy: the hook only ever reads/replaces that
 * array wholesale, so a real `useFieldArray` would add DOM/registration
 * machinery this test doesn't need. `setComparables` is exposed for tests
 * that simulate an appraiser's in-place price edit (bramka A1) without
 * routing through an actual `<input>`.
 */
function useHarness(initial: { sel: SampleSelectionSnapshot; comparables: ComparableRow[] }) {
  const { control, setValue } = useForm<FormInput>({
    defaultValues: { sampleSelection: initial.sel },
  });
  const [comparables, setComparables] = useState<ComparableRow[]>(initial.comparables);
  const replaceComparables = vi.fn((rows: ComparableRow[]) => setComparables(rows));
  const sel = useWatch({ control, name: "sampleSelection" });
  const review = useSampleReview({
    valuationId: "11111111-2222-3333-4444-555555555555",
    sel,
    comparables,
    setValue,
    replaceComparables,
    liveStreetView: null,
  });
  return { review, sel, comparables, replaceComparables, setComparables };
}

/**
 * `useSampleReview`'s new inclusion/review-trail surface (Slice 3c, Task 2)
 * — wired against a `renderHook` harness (see {@link useHarness}) rather
 * than through `StepSample`'s DOM (that's Tasks 3–5, once the UI exists).
 */
describe("useSampleReview — include/skip/keep/markReviewed (Slice 3c, Task 2)", () => {
  it("include(key) on an alternate adds a manual inclusion, marks it reviewed, resyncs comparables (12 RCN + 1 included = 13, + a pre-existing hand-added row = 14), and keeps the selection on the same row", () => {
    const proposed = Array.from({ length: 12 }, () => mk());
    const alt = mk({ pricePerM2: 20000 });
    const sel = makeSel({ proposed, alternates: [alt] });
    // A hand-added `source: "manual"` row (rtl-step-sample.test.tsx's
    // "Dodaj transakcję" shape) MUST survive too — `rebuildComparables`
    // appends non-"rcn" rows after the RCN block (review round 1, Important
    // #1: an earlier bug dropped exactly this kind of row on resync).
    const manualRow = { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" as const };
    const comparables = [...proposed.map((c) => rcnRow(c)), manualRow];
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => {
      result.current.review.setSelectedKey(candidateKey(alt));
    });
    act(() => {
      result.current.review.include(candidateKey(alt));
    });

    expect(result.current.sel?.manualInclusions ?? []).toHaveLength(1);
    expect(result.current.sel?.manualInclusions?.[0]).toMatchObject({
      transactionId: alt.transactionId,
      lokalId: alt.lokalId,
    });
    expect(result.current.sel?.reviewed?.some((r) => candidateKey(r) === candidateKey(alt))).toBe(
      true,
    );
    // 12 original RCN rows + the newly included row + the hand-added row.
    expect(result.current.comparables).toHaveLength(14);
    expect(
      result.current.comparables.some(
        (c) => c.transactionId === alt.transactionId && c.lokalId === alt.lokalId,
      ),
    ).toBe(true);
    expect(result.current.comparables.at(-1)).toEqual(manualRow);
    expect(result.current.review.statusOf(candidateKey(alt))).toBe("proposed");
    // "zaznaczenie zostaje na tym samym wierszu" (brief) — include() never
    // moves the panel's selection, unlike reject().
    expect(result.current.review.selectedKey).toBe(candidateKey(alt));
  });

  it("reject appends a reviewed mark for the rejected candidate (in addition to the manual rejection)", () => {
    const A = mk();
    const B = mk();
    const sel = makeSel({ proposed: [A, B] });
    const comparables = [A, B].map((c) => rcnRow(c));
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => result.current.review.setSelectedKey(candidateKey(A)));
    act(() => result.current.review.reject({ reason: "building_older" }));

    expect(
      result.current.sel?.manualRejections?.some((r) => candidateKey(r) === candidateKey(A)),
    ).toBe(true);
    expect(result.current.sel?.reviewed?.some((r) => candidateKey(r) === candidateKey(A))).toBe(
      true,
    );
  });

  it("skip(key) marks reviewed but never touches comparables (no resync)", () => {
    const A = mk();
    const sel = makeSel({ proposed: [A] });
    const comparables = [rcnRow(A)];
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => result.current.review.skip(candidateKey(A)));

    expect(result.current.sel?.reviewed?.some((r) => candidateKey(r) === candidateKey(A))).toBe(
      true,
    );
    expect(result.current.review.reviewStats.reviewed).toBe(1);
    expect(result.current.comparables).toEqual(comparables);
    expect(result.current.replaceComparables).not.toHaveBeenCalled();
  });

  it("include(key) after reject(key) on the SAME row removes the manual rejection and brings it back into 'W próbie'", () => {
    const A = mk();
    const B = mk();
    const sel = makeSel({ proposed: [A, B] });
    const comparables = [A, B].map((c) => rcnRow(c));
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => result.current.review.setSelectedKey(candidateKey(A)));
    act(() => result.current.review.reject({ reason: "too_far" }));
    expect(result.current.sel?.manualRejections).toHaveLength(1);
    expect(result.current.review.statusOf(candidateKey(A))).toBe("rejected");

    act(() => result.current.review.include(candidateKey(A)));

    expect(result.current.sel?.manualRejections ?? []).toHaveLength(0);
    expect(
      result.current.sel?.manualInclusions?.some((m) => candidateKey(m) === candidateKey(A)),
    ).toBe(true);
    expect(result.current.review.statusOf(candidateKey(A))).toBe("proposed");
  });

  it("keep() marks the selected candidate reviewed then advances (list's 'Zostaw'), without touching the sample", () => {
    const A = mk();
    const B = mk();
    const sel = makeSel({ proposed: [A, B] });
    const comparables = [A, B].map((c) => rcnRow(c));
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => result.current.review.setSelectedKey(candidateKey(A)));
    act(() => result.current.review.keep());

    expect(result.current.sel?.reviewed?.some((r) => candidateKey(r) === candidateKey(A))).toBe(
      true,
    );
    expect(result.current.review.selectedKey).toBe(candidateKey(B));
    expect(result.current.replaceComparables).not.toHaveBeenCalled();
  });

  it("statusOf/selectedStatus reflect the effective overlay, independent of the manual-inclusion list", () => {
    // 12 proposed (the domain's cap, DEFAULTS.proposedN) — otherwise
    // `applyManualRejections`'s own refill (which runs even with an empty
    // overlay) would top B/C straight into `proposed`, since there'd be
    // room; B/C only stay `alternates` when the cap is already full.
    const proposed = Array.from({ length: 12 }, () => mk());
    const A = proposed[0];
    const B = mk();
    const C = mk();
    const sel = makeSel({ proposed, alternates: [B, C] });
    const comparables = proposed.map((c) => rcnRow(c));
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    expect(result.current.review.statusOf(candidateKey(A))).toBe("proposed");
    expect(result.current.review.statusOf(candidateKey(B))).toBe("alternate");
    expect(result.current.review.statusOf("no-such-tx|no-such-lokal")).toBeNull();

    act(() => result.current.review.setSelectedKey(candidateKey(B)));
    expect(result.current.review.selectedStatus).toBe("alternate");

    act(() => result.current.review.reject({ reason: "too_far" }));
    expect(result.current.review.statusOf(candidateKey(B))).toBe("rejected");
  });

  it("markReviewed(key) only touches `reviewed` (leaves rejections/inclusions/comparables alone) and is idempotent", () => {
    const A = mk();
    const sel = makeSel({ proposed: [A] });
    const comparables = [rcnRow(A)];
    const { result } = renderHook(() => useHarness({ sel, comparables }));

    act(() => result.current.review.markReviewed(candidateKey(A)));
    act(() => result.current.review.markReviewed(candidateKey(A)));

    expect(result.current.sel?.reviewed).toHaveLength(1);
    expect(result.current.sel?.manualRejections ?? []).toHaveLength(0);
    expect(result.current.sel?.manualInclusions ?? []).toHaveLength(0);
    expect(result.current.comparables).toEqual(comparables);
  });

  it("bramka A1 (Slice 3c): a same-act pair in proposed + an included alternate + an edited price all survive resync after rejecting a different row", () => {
    const A1 = mk({ transactionId: "T-ACT", pricePerM2: 11000, distanceM: 100 });
    const A2 = mk({ transactionId: "T-ACT", pricePerM2: 11500, distanceM: 101 });
    const B = mk({ pricePerM2: 12000, distanceM: 102 });
    const C = mk({ pricePerM2: 13000, distanceM: 200 });
    const sel = makeSel({ proposed: [A1, A2, B], alternates: [C] });
    const comparables = [A1, A2, B].map((c) => rcnRow(c));

    const { result } = renderHook(() => useHarness({ sel, comparables }));

    // Simulate the appraiser editing A1's price in place (mirrors the
    // rtl-step-sample.test.tsx "final wave A1" scenario, minus the DOM).
    act(() => {
      result.current.setComparables((rows) =>
        rows.map((r, i) => (i === 0 ? { ...r, pricePerM2: "77777" } : r)),
      );
    });
    expect(result.current.comparables[0].pricePerM2).toBe("77777");

    // Include the alternate.
    act(() => result.current.review.include(candidateKey(C)));
    expect(result.current.comparables).toHaveLength(4);

    // Reject a DIFFERENT row (B).
    act(() => result.current.review.setSelectedKey(candidateKey(B)));
    act(() => result.current.review.reject({ reason: "building_older" }));

    const rows = result.current.comparables;
    const findRow = (c: Candidate) =>
      rows.find((r) => r.transactionId === c.transactionId && r.lokalId === c.lokalId);

    expect(rows).toHaveLength(3);
    expect(findRow(A1)?.pricePerM2).toBe("77777");
    expect(findRow(A2)?.pricePerM2).toBe(String(A2.pricePerM2));
    expect(findRow(C)?.pricePerM2).toBe(String(C.pricePerM2));
    expect(findRow(B)).toBeUndefined();
  });
});
