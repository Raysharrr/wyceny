// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleSections } from "@/app/valuations/[id]/steps/sample-sections";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { candidateKey, type Candidate } from "@/domain/sample-selection";

// jsdom ships no ResizeObserver; Radix's Checkbox mounts a hidden
// "bubble input" (native mirror, for form integration) whenever it sits
// inside a `<form>`, and that sizing effect touches ResizeObserver on mount.
// Mirrors tests/rtl-step-calculation.test.tsx.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let n = 0;
function cand(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000 + n,
    priceTotal: 600000,
    egib: {
      teryt: "306401_1",
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/82",
      budynek: String(n),
      lokal: "1",
    },
    lokalId: `306401_1.0039.AR_22.13/82.${n}_BUD.1_LOK`,
    distanceM: 10 * n,
    floor: 2,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 1, y: 2 },
    ...over,
  };
}

function snap(
  proposed: Candidate[],
  alternates: Candidate[],
  extra: Partial<SampleSelectionSnapshot> = {},
): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed,
    alternates,
    flags: {},
    rejectedCounts: {},
    rejected: [],
    manualRejections: [],
    radiusUsedM: 500,
    radiusWalk: [],
    counts: {
      pool: 100,
      inRadius: 20,
      afterHygiene: 18,
      afterBand: proposed.length + alternates.length,
      proposed: proposed.length,
    },
    params: { subjectArea: 50, todayMonth: "2026-08" },
    ...extra,
  };
}

const keyOf = (c: Candidate) => `${c.transactionId}|${c.lokalId}`;
const noop = () => {};

// Same fixpoint quirk `rtl-sample-table.test.tsx` and `use-sample-review`'s
// own fixtures work around: with `proposed.length` under `proposedN` (12),
// an unflagged alternate is silently promoted into `proposed` by the domain
// overlay (`applyManualOverlay`) — flag every alternate demoted so it stays
// an alternate in these tests.
function flagsFor(alternates: Candidate[]): SampleSelectionSnapshot["flags"] {
  return Object.fromEntries(alternates.map((c) => [candidateKey(c), ["price_outlier" as const]]));
}

describe("SampleSections", () => {
  it("renders two tables with section headers showing counts", () => {
    const p = [cand(), cand()];
    const a = [cand(), cand(), cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    expect(screen.getByText("W próbie (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alternatywy \(3\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(2);
    // Each section's `<table>` carries its own accessible name (Opus
    // review, fix round 1) — lets a query target one section's table
    // directly instead of indexing into `getAllByRole("table")`.
    expect(screen.getByRole("table", { name: "W próbie" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Alternatywy" })).toBeInTheDocument();
  });

  it("checkbox is checked in 'W próbie' and unchecked in 'Alternatywy'", () => {
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    const proposedCheckbox = screen.getByRole("checkbox", { name: /^Usuń z próby/ });
    const alternateCheckbox = screen.getByRole("checkbox", { name: /^Dodaj do próby/ });
    expect(proposedCheckbox).toBeChecked();
    expect(alternateCheckbox).not.toBeChecked();
    // The accessible name carries the row's own identity (distance here) —
    // otherwise it's identical across every row and ambiguous once more
    // than one row is on screen (Opus review, fix round 1).
    expect(proposedCheckbox).toHaveAccessibleName(new RegExp(`${Math.round(p[0].distanceM)} m`));
  });

  it("clicking the alternate row's checkbox calls onToggleInSample(key, true) and does NOT select the row", async () => {
    const onSelect = vi.fn();
    const onToggleInSample = vi.fn();
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
        onToggleInSample={onToggleInSample}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /^Dodaj do próby/ }));
    expect(onToggleInSample).toHaveBeenCalledWith(keyOf(a[0]), true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking the 'w próbie' row's checkbox calls onToggleInSample(key, false) and does NOT select the row", async () => {
    const onSelect = vi.fn();
    const onToggleInSample = vi.fn();
    const p = [cand()];
    render(
      <SampleSections
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
        onToggleInSample={onToggleInSample}
        reviewedKeys={new Set()}
        defaultAlternatesOpen={false}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /^Usuń z próby/ }));
    expect(onToggleInSample).toHaveBeenCalledWith(keyOf(p[0]), false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("↓ from the last 'W próbie' row moves to the first alternate when alternates are expanded, and moves DOM focus there", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand()];
    const a = [cand(), cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[1])}
        onSelect={onSelect}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    const proposedRows = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    proposedRows[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(a[0]));
    expect(document.querySelector(`tr[data-key="${keyOf(a[0])}"]`)).toHaveFocus();
  });

  /**
   * The overview map stamps `data-key` on its marker elements too (Slice 3b,
   * `addDotMarker`), and it renders BEFORE the tables — a document-wide
   * `[data-key=…]` lookup therefore focused a map dot, and the next arrow key
   * went nowhere because focus had left the list (runtime bug, team-lead
   * 2026-08-22: ↑/↓ moved the selection exactly once).
   */
  it("↓ focuses the table row even when another element carries the same data-key", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand()];
    const a = [cand()];
    const decoy = document.createElement("div");
    decoy.tabIndex = 0;
    decoy.dataset.key = keyOf(a[0]);
    document.body.prepend(decoy);
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[1])}
        onSelect={onSelect}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    const proposedRows = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    proposedRows[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.querySelector(`tr[data-key="${keyOf(a[0])}"]`)).toHaveFocus();
    expect(decoy).not.toHaveFocus();
    decoy.remove();
  });

  it("↓ from the last 'W próbie' row is a no-op while alternates are collapsed", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen={false}
      />,
    );
    const proposedRows = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    proposedRows[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a ✓ only for rows in reviewedKeys, in either section", () => {
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set([keyOf(a[0])])}
        defaultAlternatesOpen
      />,
    );
    const tables = screen.getAllByRole("table");
    const proposedRow = within(tables[0]).getAllByRole("row").slice(1)[0];
    const alternateRow = within(tables[1]).getAllByRole("row").slice(1)[0];
    expect(within(proposedRow).queryByLabelText("przejrzane")).toBeNull();
    expect(within(alternateRow).getByLabelText("przejrzane")).toBeInTheDocument();
  });

  it("collapsing 'Alternatywy' clears the selection when the selected row was an alternate no longer visible", async () => {
    const onSelect = vi.fn();
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(a[0])}
        onSelect={onSelect}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Alternatywy \(1\)/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("collapsing 'Alternatywy' leaves a still-visible (proposed) selection untouched", async () => {
    const onSelect = vi.fn();
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[0])}
        onSelect={onSelect}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Alternatywy \(1\)/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("defaultAlternatesOpen=false starts with alternates collapsed (no second table)", () => {
    const p = [cand()];
    const a = [cand()];
    render(
      <SampleSections
        selection={snap(p, a, { flags: flagsFor(a) })}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen={false}
      />,
    );
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Alternatywy \(1\)/, expanded: false }),
    ).toBeInTheDocument();
  });

  it("reflects manualRejections through effectiveSelection: a rejected proposed row disappears and the first alternate backfills 'W próbie'", () => {
    const p = [cand(), cand()];
    const a = [cand()];
    // Deliberately UNFLAGGED (unlike the other fixtures in this file) — the
    // point of this test is that the domain overlay promotes it into
    // `proposed` once the rejection opens a slot.
    const selection = snap(p, a, {
      manualRejections: [
        {
          transactionId: p[0].transactionId,
          lokalId: p[0].lokalId,
          reason: "building_older",
          at: "2026-08-21T10:00:00Z",
        },
      ],
    });
    render(
      <SampleSections
        selection={selection}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    expect(screen.getByText("W próbie (2)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alternatywy/ })).toBeNull();
  });

  it("smoke: an empty selection (no proposed, no alternates) renders an empty 'W próbie (0)' table and no Alternatywy button", () => {
    render(
      <SampleSections
        selection={snap([], [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
        reviewedKeys={new Set()}
        defaultAlternatesOpen
      />,
    );
    expect(screen.getByText("W próbie (0)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alternatywy/ })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1); // header only
  });
});
