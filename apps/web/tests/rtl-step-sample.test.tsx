// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Comparable } from "@/domain/kcs";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). Mirrors tests/rtl-step-inspection.test.tsx.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const saveSampleAction = vi.fn();
vi.mock("@/app/actions/wizard", () => ({
  saveSampleAction: (...args: unknown[]) => saveSampleAction(...args),
}));

const getSampleProposal = vi.fn();
vi.mock("@/app/actions/get-sample-proposal", () => ({
  getSampleProposal: (...args: unknown[]) => getSampleProposal(...args),
}));

import { StepSample } from "@/app/valuations/[id]/steps/step-sample";

const VID = "11111111-2222-3333-4444-555555555555";
const ADDRESS = "ul. Kościelna 33, Poznań";
const AREA = 71.63;

function twelveComparables(): Comparable[] {
  return Array.from({ length: 12 }, (_, i) => ({
    date: `2024-${String(i + 1).padStart(2, "0")}`,
    area: 60 + i,
    pricePerM2: 10000 + i * 100,
    source: "manual",
  }));
}

describe("StepSample — defaults", () => {
  it("renders one row per existing comparable and no amber hint at 12", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={null}
      />,
    );

    const priceInputs = screen.getAllByPlaceholderText("zł/m²");
    expect(priceInputs).toHaveLength(12);
    expect(screen.queryByText(/wymaga co najmniej 12 transakcji/i)).toBeNull();
  });
});

describe("StepSample — RCN fetch", () => {
  it("replaces rows with the RCN proposal and includes sampleMeta on submit", async () => {
    const user = userEvent.setup();
    const proposal = {
      transactions: [
        { date: "2024-05", area: 61, pricePerM2: 11000, transactionId: "T1" },
        { date: "2024-06", area: 62, pricePerM2: 11500, transactionId: "T2" },
        { date: "2024-07", area: 63, pricePerM2: 12000, transactionId: "T3" },
      ],
      meta: {
        lat: 52.4,
        lon: 16.9,
        fetchedAt: "2026-07-23T10:00:00Z",
        source: "geokoder",
        query: { bbox: [1, 2, 3, 4], count: 100, sort: "distance" },
      },
    };
    getSampleProposal.mockResolvedValue({ proposal });
    saveSampleAction.mockResolvedValue({ ok: true });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[]}
        sampleMeta={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pobierz próbę z rcn/i }));

    await waitFor(() =>
      expect(getSampleProposal).toHaveBeenCalledWith({ address: ADDRESS, area: AREA }),
    );
    await waitFor(() => expect(screen.getAllByPlaceholderText("zł/m²")).toHaveLength(3));
    expect(screen.getByDisplayValue("11000")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [id, payload] = saveSampleAction.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(id).toBe(VID);
    expect(payload.sampleMeta).toMatchObject({ source: "geokoder" });
    expect(payload.comparables).toHaveLength(3);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/valuations/${VID}?step=4`));
  });
});

describe("StepSample — submit", () => {
  beforeEach(() => {
    saveSampleAction.mockClear();
    pushMock.mockClear();
  });

  it("saves via saveSampleAction and navigates to step 4", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockResolvedValue({ ok: true });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    expect(saveSampleAction).toHaveBeenCalledWith(
      VID,
      expect.objectContaining({ comparables: expect.any(Array) }),
    );
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [string, { comparables: unknown[] }];
    expect(payload.comparables).toHaveLength(12);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/valuations/${VID}?step=4`));
  });

  it("shows an inline error when the save action returns one", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockResolvedValue({
      error: "Nie udało się zapisać próby — spróbuj ponownie.",
    });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/nie udało się zapisać próby/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("StepSample — validation", () => {
  beforeEach(() => {
    saveSampleAction.mockClear();
  });

  it("blocks submit with fewer than 3 comparables and shows the zod message", async () => {
    const user = userEvent.setup();
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[
          { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" },
          { date: "2024-02", area: 61, pricePerM2: 10100, source: "manual" },
        ]}
        sampleMeta={null}
      />,
    );

    expect(screen.getAllByPlaceholderText("zł/m²")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/co najmniej 3/i));
    expect(saveSampleAction).not.toHaveBeenCalled();
  });

  it("shows the amber hint below 12 comparables", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[
          { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" },
          { date: "2024-02", area: 61, pricePerM2: 10100, source: "manual" },
          { date: "2024-03", area: 62, pricePerM2: 10200, source: "manual" },
          { date: "2024-04", area: 63, pricePerM2: 10300, source: "manual" },
          { date: "2024-05", area: 64, pricePerM2: 10400, source: "manual" },
        ]}
        sampleMeta={null}
      />,
    );

    const hint = screen.getByText(/wymaga co najmniej 12 transakcji/i);
    expect(hint.textContent).toMatch(/masz 5/i);
  });
});
