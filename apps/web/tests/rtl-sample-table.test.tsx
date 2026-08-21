// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleTable } from "@/app/valuations/[id]/steps/sample-table";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { candidateKey, type Candidate } from "@/domain/sample-selection";

afterEach(cleanup);
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
    params: {
      subjectArea: 50,
      todayMonth: "2026-08",
      subjectEgib: { obreb: "0039", arkusz: "22", dzialka: "13/82", budynek: "1" },
    },
    ...extra,
  };
}

describe("SampleTable", () => {
  it("renders proposed rows with thumbnail, obręb label, distance, badges; alternates collapsed behind a button", async () => {
    const p = [cand(), cand()];
    const a = [cand(), cand(), cand()];
    const key = `0039.22.13/82.${p[0].egib!.budynek}`;
    // Real selectSample always fills `proposed` to the cap (12) first, so the
    // domain's refill-from-alternates (applyManualRejections, Task 1) never
    // fires with room to spare. This tiny fixture is under the cap on
    // purpose (for a readable assertion) — flagging the alternates as
    // price_outlier keeps them demoted (ADR-015 rules 5/7), same as the
    // "never promotes a flagged alternate" case in sample-manual.test.ts,
    // so they stay alternates instead of being silently promoted.
    const flags = Object.fromEntries(a.map((c) => [candidateKey(c), ["price_outlier" as const]]));
    render(
      <SampleTable
        selection={snap(p, a, { flags })}
        streetView={{
          [key]: {
            panoId: "P",
            captureDate: "2023-07",
            thumbnailKey: `streetview/${key}.jpg`,
            heading: 10,
            lat: 1,
            lng: 2,
          },
        }}
        streetViewEnabled
        selectedKey={null}
        onSelect={() => {}}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("img")).toHaveAttribute(
      "src",
      `/api/docs/${encodeURIComponent(`streetview/${key}.jpg`)}`,
    );
    expect(within(rows[0]).getByText("0039")).toBeInTheDocument();
    expect(within(rows[0]).getByText("ten sam budynek")).toBeInTheDocument();
    expect(within(rows[0]).getByText("10 m")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Alternatywy \(3\)/ }));
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(5);
  });
  it("no panorama → placeholder with capture year text; streetView disabled → no img at all", () => {
    const p = [cand()];
    const key = `0039.22.13/82.${p[0].egib!.budynek}`;
    const { rerender } = render(
      <SampleTable
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
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/brak zdjęcia ulicy/)).toBeInTheDocument();
    rerender(
      <SampleTable
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/brak zdjęcia ulicy/)).toBeNull();
  });
  it("click / Enter / arrows select rows; selected row carries data-state=selected", async () => {
    const onSelect = vi.fn();
    const p = [cand(), cand(), cand()];
    const keyOf = (c: Candidate) => `${c.transactionId}|${c.lokalId}`;
    const { rerender } = render(
      <SampleTable
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    await userEvent.click(rows[1]);
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[1]));
    rerender(
      <SampleTable
        selection={snap(p, [])}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={keyOf(p[1])}
        onSelect={onSelect}
      />,
    );
    expect(screen.getAllByRole("row").slice(1)[1]).toHaveAttribute("data-state", "selected");
    screen.getAllByRole("row").slice(1)[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[2]));
    await userEvent.keyboard("{ArrowUp}");
    expect(onSelect).toHaveBeenLastCalledWith(keyOf(p[0]));
  });
  it("manual rejections are applied: a rejected proposed row disappears and the first alternate takes its place", () => {
    const p = [cand(), cand()];
    const a = [cand()];
    const s = snap(p, a, {
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
      <SampleTable
        selection={s}
        streetView={null}
        streetViewEnabled={false}
        selectedKey={null}
        onSelect={() => {}}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(`${a[0].distanceM} m`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alternatywy/ })).toBeNull();
  });
});
