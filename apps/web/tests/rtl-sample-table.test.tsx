// @vitest-environment jsdom
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleTable } from "@/app/valuations/[id]/steps/sample-table";
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
// Real shape from `thumbnailKey()` (app/actions/_street-view-enrich.ts):
// `streetview-${buildingKey.replaceAll("/", "~")}.jpg` — slash-free because
// `buildingKey` itself contains "/" (the `dzialka` component, e.g. "13/82").
const thumbKey = (buildingKey: string) => `streetview-${buildingKey.replaceAll("/", "~")}.jpg`;

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
    params: {
      subjectArea: 50,
      todayMonth: "2026-08",
      subjectEgib: { obreb: "0039", arkusz: "22", dzialka: "13/82", budynek: "1" },
    },
    ...extra,
  };
}

const keyOf = (c: Candidate) => `${c.transactionId}|${c.lokalId}`;
const noop = () => {};

describe("SampleTable", () => {
  it("renders proposed rows with thumbnail, obręb label, distance, badges", () => {
    const p = [cand(), cand()];
    const key = `0039.22.13/82.${p[0].egib!.budynek}`;
    const flags = { [candidateKey(p[1])]: [] };
    const key1 = thumbKey(key);
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [], { flags })}
        streetView={{
          [key]: {
            panoId: "P",
            captureDate: "2023-07",
            thumbnailKey: key1,
            heading: 10,
            lat: 1,
            lng: 2,
          },
        }}
        streetViewEnabled
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("img")).toHaveAttribute(
      "src",
      `/api/docs/${encodeURIComponent(key1)}`,
    );
    expect(within(rows[0]).getByText("0039")).toBeInTheDocument();
    expect(within(rows[0]).getByText("ten sam budynek")).toBeInTheDocument();
    expect(within(rows[0]).getByText("10 m")).toBeInTheDocument();
  });

  it("no panorama → placeholder text (M3, final wave addendum: no capture-date suffix, unreachable — panoId null implies captureDate null); streetView disabled → no img at all", () => {
    const p = [cand()];
    const key = `0039.22.13/82.${p[0].egib!.budynek}`;
    const { rerender } = render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={{
          [key]: {
            panoId: null,
            captureDate: null,
            thumbnailKey: null,
            heading: null,
            lat: 1,
            lng: 2,
          },
        }}
        streetViewEnabled
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    expect(screen.getByText(/brak zdjęcia ulicy/)).toBeInTheDocument();
    rerender(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/brak zdjęcia ulicy/)).toBeNull();
  });

  it("NO street-view entry at all for the building (enrichment skipped/failed) → 'brak miniaturki', not a blank caption (final wave B11)", () => {
    const p = [cand()];
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={{}}
        streetViewEnabled
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    expect(screen.getByText("brak miniaturki")).toBeInTheDocument();
    expect(screen.queryByText(/brak zdjęcia ulicy/)).toBeNull();
  });

  it("click selects a row; the parent re-rendering with the new selectedKey marks it data-state=selected", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand(), cand()];
    const { rerender } = render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    await userEvent.click(rows[1]);
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[1]));
    rerender(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[1])}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );
    expect(screen.getAllByRole("row").slice(1)[1]).toHaveAttribute("data-state", "selected");
  });

  it("arrow keys walk from the CURRENT selection (via allKeys), not the row the keydown fired on, and move DOM focus with them", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand(), cand(), cand()];
    const rowsAfterHeader = () => screen.getAllByRole("row").slice(1);
    const { rerender } = render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[1])}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );

    rowsAfterHeader()[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[2]));
    expect(rowsAfterHeader()[2]).toHaveFocus();

    // The parent updates `selectedKey` from the onSelect call above (this is
    // what step-sample.tsx's own `setSelectedKey` does) — a second ArrowDown
    // must walk on from p[2], not repeat p[2] again by re-anchoring on the
    // row that received the FIRST keydown (the regression this locks in).
    rerender(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[2])}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[3]));

    rerender(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[3])}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );
    await userEvent.keyboard("{ArrowUp}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[2]));
  });

  it("arrow down at the end of allKeys is a no-op (SampleSections owns crossing into alternates)", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand()];
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
        onToggleInSample={noop}
      />,
    );
    const lastRow = screen.getAllByRole("row").slice(1).at(-1)!;
    lastRow.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter and Space select the focused row without submitting the enclosing form", async () => {
    const onSelect = vi.fn();
    const submitSpy = vi.fn((e: FormEvent) => e.preventDefault());
    const p = [cand(), cand()];
    render(
      <form onSubmit={submitSpy}>
        <SampleTable
          rows={p}
          kind="proposed"
          allKeys={p.map(keyOf)}
          reviewedKeys={new Set()}
          selection={snap(p, [])}
          streetView={null}
          streetViewEnabled={false}
          selectedKey={null}
          onSelect={onSelect}
          onToggleInSample={noop}
        />
      </form>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    rows[0].focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[0]));
    await userEvent.keyboard("[Space]");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[0]));
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("checkbox reflects `kind`: checked for proposed rows, unchecked for alternate rows, with the matching aria-label", () => {
    const p = [cand()];
    const a = [cand()];
    const { rerender } = render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    const proposedCheckbox = screen.getByRole("checkbox", { name: /^Usuń z próby/ });
    expect(proposedCheckbox).toBeChecked();
    expect(proposedCheckbox).toHaveAttribute("type", "button");
    // The accessible name carries the row's own identity (date/distance/
    // price) as a suffix — otherwise every row's name is identical and
    // `getByRole("checkbox", { name })` is ambiguous once more than one row
    // is on screen (Opus review, fix round 1).
    expect(proposedCheckbox).toHaveAccessibleName(new RegExp(`${Math.round(p[0].distanceM)} m`));

    rerender(
      <SampleTable
        rows={a}
        kind="alternate"
        allKeys={a.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap([], a)}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    const alternateCheckbox = screen.getByRole("checkbox", { name: /^Dodaj do próby/ });
    expect(alternateCheckbox).not.toBeChecked();
  });

  it("clicking a row's checkbox calls onToggleInSample and does NOT select the row (mouse) or submit the form (keyboard)", async () => {
    const onSelect = vi.fn();
    const onToggleInSample = vi.fn();
    const submitSpy = vi.fn((e: FormEvent) => e.preventDefault());
    const a = [cand()];
    render(
      <form onSubmit={submitSpy}>
        <SampleTable
          rows={a}
          kind="alternate"
          allKeys={a.map(keyOf)}
          reviewedKeys={new Set()}
          selection={snap([], a)}
          streetView={null}
          streetViewEnabled={false}
          selectedKey={null}
          onSelect={onSelect}
          onToggleInSample={onToggleInSample}
        />
      </form>,
    );
    const checkbox = screen.getByRole("checkbox", { name: /^Dodaj do próby/ });
    await userEvent.click(checkbox);
    expect(onToggleInSample).toHaveBeenCalledWith(keyOf(a[0]), true);
    expect(onSelect).not.toHaveBeenCalled();

    checkbox.focus();
    await userEvent.keyboard("[Space]");
    expect(onSelect).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("shows a ✓ (aria-label „przejrzane”) only for rows in reviewedKeys", () => {
    const p = [cand(), cand()];
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set([keyOf(p[1])])}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).queryByLabelText("przejrzane")).toBeNull();
    expect(within(rows[1]).getByLabelText("przejrzane")).toBeInTheDocument();
  });

  it("shows a 'dodana ręcznie' badge only for rows in includedKeys (Slice 3c, Task 5)", () => {
    const p = [cand(), cand()];
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        includedKeys={new Set([keyOf(p[1])])}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).queryByText("dodana ręcznie")).toBeNull();
    expect(within(rows[1]).getByText("dodana ręcznie")).toBeInTheDocument();
  });

  it("includedKeys defaults to empty — no badge when the prop is omitted", () => {
    const p = [cand()];
    render(
      <SampleTable
        rows={p}
        kind="proposed"
        allKeys={p.map(keyOf)}
        reviewedKeys={new Set()}
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={noop}
        onToggleInSample={noop}
      />,
    );
    expect(screen.queryByText("dodana ręcznie")).toBeNull();
  });
});
