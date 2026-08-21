// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleRejected } from "@/app/valuations/[id]/steps/sample-rejected";
import type { RejectedRow, SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";
import type { ManualRejection } from "@/domain/sample-manual";

afterEach(cleanup);

const row = (reason: RejectedRow["reason"], i: number): RejectedRow => ({
  transactionId: `R${i}`,
  lokalId: `L${i}`,
  reason,
  allReasons: [reason],
  date: "2026-01-01",
  area: 40,
  pricePerM2: 9000,
  distanceM: 100,
  pos: null,
});

const cand = (i: number, over: Partial<Candidate> = {}): Candidate => ({
  transactionId: `P${i}`,
  date: "2026-05-01",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: null,
  lokalId: `PL${i}`,
  distanceM: 50,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos: null,
  ...over,
});

function snap(over: Partial<SampleSelectionSnapshot>): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [cand(1)],
    alternates: [],
    flags: {},
    rejectedCounts: {},
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
    params: { subjectArea: 50, todayMonth: "2026-08" },
    ...over,
  };
}

describe("SampleRejected", () => {
  it("collapsed shows Odrzucone (N) = sum(rejectedCounts) + manualRejections.length; expands to grouped rows; manual row has Przywróć", async () => {
    const onRestore = vi.fn();
    const s = snap({
      rejected: [row("out_of_area_band", 1), row("primary_market", 2)],
      rejectedCounts: { out_of_area_band: 1, primary_market: 1 },
      manualRejections: [
        {
          transactionId: "P1",
          lokalId: "PL1",
          reason: "building_older",
          note: "1905",
          at: "2026-08-21T10:00:00Z",
        },
      ],
    });
    render(<SampleRejected selection={s} onRestore={onRestore} />);

    const toggle = screen.getByRole("button", { name: /Odrzucone \(3\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("poza pasmem metrażu")).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("poza pasmem metrażu")).toBeInTheDocument();
    expect(screen.getByText("rynek pierwotny")).toBeInTheDocument();
    expect(screen.getByText("budynek starszy")).toBeInTheDocument();
    expect(screen.getByText(/„1905”/)).toBeInTheDocument();

    const restoreBtn = screen.getByRole("button", { name: /Przywróć/ });
    await userEvent.click(restoreBtn);
    expect(onRestore).toHaveBeenCalledWith({
      transactionId: "P1",
      lokalId: "PL1",
      reason: "building_older",
      note: "1905",
      at: "2026-08-21T10:00:00Z",
    } satisfies ManualRejection);
  });

  it("shows 'najbliższe K z M' when `rejected` is a capped sample of the full `rejectedCounts` census", async () => {
    const s = snap({
      rejected: [row("out_of_area_band", 1), row("out_of_area_band", 2)],
      rejectedCounts: { out_of_area_band: 174 },
    });
    render(<SampleRejected selection={s} onRestore={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /Odrzucone \(174\)/ });
    await userEvent.click(toggle);
    expect(screen.getByText(/najbliższe 2 z 174/)).toBeInTheDocument();
  });

  it("pre-Slice-3 snapshot without `rejected` shows only rejectedCounts badges + a re-fetch hint", async () => {
    const s = snap({ rejectedCounts: { no_price: 4 } });
    render(<SampleRejected selection={s} onRestore={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /Odrzucone \(4\)/ });
    await userEvent.click(toggle);

    expect(
      screen.getByText(/lista odrzuconych dostępna po ponownym pobraniu próby/i),
    ).toBeInTheDocument();
    expect(screen.getByText("brak ceny lub powierzchni · 4")).toBeInTheDocument();
  });
});
