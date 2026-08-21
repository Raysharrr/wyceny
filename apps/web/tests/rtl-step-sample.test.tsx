// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Comparable, SampleMeta } from "@/domain/kcs";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";

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

const reselectSample = vi.fn();
vi.mock("@/app/actions/reselect-sample", () => ({
  reselectSample: (...args: unknown[]) => reselectSample(...args),
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

/** A v3 `SampleMeta` (ADR-015) — `CandidatePool` minus `candidates`. */
function makeSampleMeta(overrides: { truncated?: boolean } = {}): SampleMeta {
  return {
    point: { x: 100, y: 200, source: "subject" },
    maxRadiusM: 3000,
    // Deliberately DIFFERENT from `makeSampleSelection().counts.pool` (9000):
    // the "przebadano" banner count must come from the v3 selection snapshot,
    // not from sampleMeta — an assertion against 9000 alone couldn't tell the
    // two apart when both fixtures happened to share the same number.
    counts: { fetched: 9400, deduped: 8000, noPos: 10 },
    fetchedAt: "2026-07-23T10:00:00Z",
    source: "rcn-wfs-gugik",
    query: {
      bbox: [1, 2, 3, 4],
      count: 100,
      sort: "distance",
      pages: 1,
      truncated: overrides.truncated ?? false,
    },
  };
}

/**
 * A fully-populated `Candidate` (all 16 fields) — the shape `candidateSchema`
 * actually validates on the client (`zodResolver(sampleStepSchema)` gates
 * submit). Needed so at least one `sampleSelection` fixture below exercises
 * that resolver with a real row, not an empty `proposed`/`alternates` array —
 * an empty array can't reveal a schema/domain field mismatch that would
 * silently block submit in production with no visible error (only
 * `errors.comparables` is rendered, never `errors.sampleSelection`).
 */
function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    transactionId: "T-100",
    date: "2024-05",
    area: 61,
    pricePerM2: 11000,
    priceTotal: 671000,
    egib: { teryt: "306401", obreb: "0001", arkusz: "12", dzialka: "34", budynek: "5", lokal: "6" },
    lokalId: "306401_1.0001.34_BUD_5_LOK_6",
    distanceM: 120,
    floor: 2,
    rooms: 3,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 100, y: 200 },
    ...overrides,
  };
}

/** A v3 `SampleSelectionSnapshot` (ADR-015). */
function makeSampleSelection(
  overrides: {
    radiusUsedM?: number;
    counts?: Partial<SampleSelectionSnapshot["counts"]>;
    proposed?: Candidate[];
    alternates?: Candidate[];
  } = {},
): SampleSelectionSnapshot {
  return {
    version: 3,
    // Two real candidates by default (not `[]`) — the RCN-fetch banner reads
    // its "Dobrano N z …" count from `effectiveSelection(sel).proposed`, so a
    // fixture whose `counts.proposed` (2, below) doesn't match a real
    // `proposed` array would silently desync banner text from candidate rows.
    proposed: overrides.proposed ?? [
      makeCandidate({ transactionId: "T-DEFAULT-1" }),
      makeCandidate({
        transactionId: "T-DEFAULT-2",
        lokalId: "306401_1.0001.34_BUD_5_LOK_7",
      }),
    ],
    alternates: overrides.alternates ?? [],
    flags: {},
    rejectedCounts: {},
    rejected: [],
    manualRejections: [],
    radiusUsedM: overrides.radiusUsedM ?? 500,
    radiusWalk: [],
    counts: {
      pool: 9000,
      inRadius: 60,
      afterHygiene: 50,
      afterBand: 48,
      proposed: 2,
      ...overrides.counts,
    },
    params: { subjectArea: 50, todayMonth: "2026-08" },
  };
}

/** A v3 `StreetViewSnapshot` (ADR-011, Slice 3) — one building's frozen lookup. */
function makeStreetView(): StreetViewSnapshot {
  return {
    "0001.12.34.5": {
      panoId: "PANO-1",
      captureDate: "2023-07",
      thumbnailKey: "streetview-0001.12.34~5.jpg",
      heading: 90,
      lat: 52.4,
      lng: 16.9,
    },
  };
}

/**
 * The banner's own text is split across the outer `<AutoBanner>` container
 * and nested `<b>` tags — RTL's `getByText` only matches an element's DIRECT
 * text-node children, not text inside nested elements, so a single regex
 * spanning "Dobrano X z Y…w promieniu R m" can't land on any one node via
 * `screen.getByText`. Reading the container's full `textContent` instead
 * (keyed by `AutoBanner`'s own `data-kind` attribute) sidesteps that and
 * asserts on what the appraiser actually sees.
 */
function bannerText(container: HTMLElement): string | null {
  return container.querySelector('[data-kind="info"]')?.textContent ?? null;
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
        sampleSelection={null}
        streetView={null}
      />,
    );

    const priceInputs = screen.getAllByPlaceholderText("zł/m²");
    expect(priceInputs).toHaveLength(12);
    expect(screen.queryByText(/wymaga co najmniej 12 transakcji/i)).toBeNull();
  });
});

describe("StepSample — RCN fetch", () => {
  it("fetches the v3 proposal, replaces rows, shows the banner, and round-trips sampleSelection/sampleMeta/streetView on submit", async () => {
    const user = userEvent.setup();
    const proposal = {
      comparables: [
        { date: "2024-05", area: 61, pricePerM2: 11000, transactionId: "T1" },
        { date: "2024-06", area: 62, pricePerM2: 11500, transactionId: "T2" },
      ],
      sampleSelection: makeSampleSelection(),
      sampleMeta: makeSampleMeta({ truncated: false }),
      streetView: makeStreetView(),
    };
    getSampleProposal.mockResolvedValue({ proposal });
    saveSampleAction.mockResolvedValue({ ok: true });

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pobierz próbę z rcn/i }));

    // (a) called with the full v3 input shape, including valuationId.
    await waitFor(() =>
      expect(getSampleProposal).toHaveBeenCalledWith({
        valuationId: VID,
        address: ADDRESS,
        area: AREA,
      }),
    );

    // (b) rows replaced.
    await waitFor(() =>
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "11000",
      ),
    );
    expect((container.querySelector("#comparable-price-1") as HTMLInputElement).value).toBe(
      "11500",
    );
    expect(container.querySelector("#comparable-price-2")).toBeNull();

    // (d) honest banner — counts/radius from the v3 selection snapshot.
    expect(bannerText(container)).toMatch(/Dobrano 2 z 48 pasujących w promieniu 500 m/);
    expect(bannerText(container)).toMatch(/przebadano 9000/);
    expect(bannerText(container)).not.toMatch(/pula może być niepełna/);

    // The form still enforces "at least 3 comparables" (comparableSchema),
    // so a 2-row fetch alone can't reach submit — add a third row by hand,
    // like the "hand-typed row" test below, purely to clear that gate.
    await user.click(screen.getByRole("button", { name: /dodaj transakcję/i }));
    const prices = await screen.findAllByPlaceholderText("zł/m²");
    expect(prices).toHaveLength(3);
    await user.type(prices[2], "9999");

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    // (c) sampleSelection/sampleMeta/streetView round-trip into the save payload.
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [id, payload] = saveSampleAction.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(id).toBe(VID);
    expect(payload.sampleSelection).toMatchObject({ radiusUsedM: 500 });
    expect(payload.sampleMeta).toMatchObject({ query: { truncated: false } });
    expect(payload.streetView).toEqual(proposal.streetView);
    expect(payload.comparables).toHaveLength(3);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/valuations/${VID}?step=4`));
  });

  it("rounds RCN-proposed price and area to 2 decimals before populating inputs", async () => {
    const user = userEvent.setup();
    const proposal = {
      comparables: [
        {
          date: "2024-05",
          area: 61.567234,
          pricePerM2: 16030.8916015625,
          transactionId: "T1",
        },
      ],
      sampleSelection: makeSampleSelection(),
      sampleMeta: makeSampleMeta(),
    };
    getSampleProposal.mockResolvedValue({ proposal });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pobierz próbę z rcn/i }));

    await waitFor(() =>
      expect(getSampleProposal).toHaveBeenCalledWith({
        valuationId: VID,
        address: ADDRESS,
        area: AREA,
      }),
    );
    await waitFor(() => expect(screen.getByDisplayValue("16030.89")).toBeDefined());
    expect(screen.getByDisplayValue("61.57")).toBeDefined();
  });

  it("(e) appends the truncated-pool warning when sampleMeta.query.truncated is true", async () => {
    const user = userEvent.setup();
    const proposal = {
      comparables: [{ date: "2024-05", area: 61, pricePerM2: 11000, transactionId: "T1" }],
      sampleSelection: makeSampleSelection(),
      sampleMeta: makeSampleMeta({ truncated: true }),
    };
    getSampleProposal.mockResolvedValue({ proposal });

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pobierz próbę z rcn/i }));

    await waitFor(() => expect(bannerText(container)).toMatch(/Dobrano/));
    expect(bannerText(container)).toMatch(/pula może być niepełna/);
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
        sampleSelection={null}
        streetView={null}
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
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/nie udało się zapisać próby/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  /**
   * A save that never re-fetches (e.g. the appraiser only hand-edits a
   * price) must still send the PRE-EXISTING `sampleSelection` snapshot —
   * omitting it here would wipe the persisted selection to null even though
   * nothing about the sample selection itself changed. The snapshot carries
   * a FULLY-POPULATED `proposed` candidate (not an empty array) so this test
   * also exercises `candidateSchema` on the client's `zodResolver` — the
   * gate that actually decides whether "Zatwierdź próbę i dalej" does
   * anything at all; an empty array would let a real schema/domain mismatch
   * through silently (no `errors.sampleSelection` is ever rendered).
   */
  it("keeps a pre-existing sampleSelection/streetView prop (with a populated candidate) in the save payload without re-fetching", async () => {
    const user = userEvent.setup();
    getSampleProposal.mockClear();
    saveSampleAction.mockResolvedValue({ ok: true });
    const existingSelection = makeSampleSelection({
      radiusUsedM: 777,
      proposed: [makeCandidate()],
    });
    const existingStreetView = makeStreetView();

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={makeSampleMeta()}
        sampleSelection={existingSelection}
        streetView={existingStreetView}
      />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    expect(getSampleProposal).not.toHaveBeenCalled();
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      { sampleSelection?: SampleSelectionSnapshot; streetView?: StreetViewSnapshot },
    ];
    expect(payload.sampleSelection?.proposed).toHaveLength(1);
    expect(payload.sampleSelection?.proposed[0]).toMatchObject({ transactionId: "T-100" });
    expect(payload.sampleSelection).toMatchObject({ radiusUsedM: 777 });
    // A save that never re-fetches must still send the PRE-EXISTING
    // `streetView` snapshot too — same "omitting it wipes it to null" risk
    // the sampleSelection assertions above guard against.
    expect(payload.streetView).toEqual(existingStreetView);
  });
});

/**
 * The premise the ACL's `transactionId ? "rcn" : …` rule rests on: the form
 * has no input for an id, so a row the appraiser adds by hand cannot carry
 * one. If this ever stops holding, that rule would relabel hand-typed rows as
 * fetched — and the bulk confirm would stamp them as verified machine data.
 */
describe("StepSample — a hand-typed row carries no transactionId", () => {
  it("submits an appended row with no id, so the ACL still reads it as manual", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockClear();
    saveSampleAction.mockResolvedValue({ ok: true });

    const fetched = twelveComparables().map((c, i) => ({
      ...c,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
    }));

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={fetched}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /dodaj transakcję/i }));
    const prices = await screen.findAllByPlaceholderText("zł/m²");
    expect(prices).toHaveLength(13);
    await user.type(prices[12], "12345");

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      { comparables: Array<{ source?: string; transactionId?: string }> },
    ];
    expect(payload.comparables).toHaveLength(13);
    expect(payload.comparables[12].transactionId).toBeUndefined();
    expect(payload.comparables[12].source).toBeUndefined();
    // …while the fetched rows still round-trip theirs, which is what the
    // matcher in `applySampleUpdate` keys confirmations on.
    expect(payload.comparables[0].transactionId).toBe("tx-0");
  });
});

/**
 * A draft persisted before ADR-015 v3 shipped carries the old `sampleMeta`
 * shape (`lat`/`lon` instead of `point`, no `maxRadiusM`/`counts`), which
 * fails `sampleMetaSchema` on submit. Before this fix that error had no
 * visible surface (only `errors.comparables` was ever rendered) — the
 * appraiser saw the button do nothing.
 */
describe("StepSample — legacy v2 sampleMeta draft (item A)", () => {
  it("surfaces the resolver error instead of a silently inert submit", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockClear();

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[
          { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" },
          { date: "2024-02", area: 61, pricePerM2: 10100, source: "manual" },
          { date: "2024-03", area: 62, pricePerM2: 10200, source: "manual" },
        ]}
        sampleMeta={
          {
            lat: 52.4,
            lon: 16.9,
            fetchedAt: "2026-07-14T10:00:00.000Z",
            source: "rcn-wfs-gugik",
            query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
        sampleSelection={null}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /ta próba pochodzi ze starszej wersji doboru/i,
      ),
    );
    expect(saveSampleAction).not.toHaveBeenCalled();
  });
});

describe("StepSample — stats sidebar + RCN banner (Slice 12 visual parity, ADR-015 v3 copy)", () => {
  it("shows Statystyki próby with Cmin/Cmax/Cśr and the V-ratio range for ≥2 comparable prices", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[
          { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" },
          { date: "2024-02", area: 61, pricePerM2: 12000, source: "manual" },
        ]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    expect(screen.getByText("Statystyki próby")).toBeInTheDocument();
    // Cmin=10000, Cmax=12000, Cśr=11000 -> Vmin=10000/11000=0,909, Vmax=12000/11000=1,091
    expect(screen.getByText(/Granice korekty/)).toBeInTheDocument();
    expect(screen.getByText("0,909")).toBeInTheDocument();
    expect(screen.getByText("1,091")).toBeInTheDocument();
  });

  it("hides the V-ratio range when there are no valid comparable prices", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    expect(screen.getByText("Statystyki próby")).toBeInTheDocument();
    expect(screen.queryByText(/Granice korekty/)).toBeNull();
  });

  it("(f) does not show the RCN AutoBanner without sampleMeta", () => {
    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    expect(container.querySelector('[data-kind="info"]')).toBeNull();
  });

  it("asks for a re-fetch (no question marks) when sampleMeta is present without a matching sampleSelection", () => {
    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={makeSampleMeta()}
        sampleSelection={null}
        streetView={null}
      />,
    );

    // No matching `sampleSelection` (hand-edited sample, test data) → no counts to
    // show, so the banner says so instead of printing question marks.
    const text = bannerText(container);
    expect(text).not.toContain("?");
    expect(text).toMatch(/pobierz próbę z RCN ponownie/i);
    expect(text).toMatch(/23\.07\.2026/);
  });

  it("shows the FootNav mid slot with the valid-price count and Cśr once stats are available", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[
          { date: "2024-01", area: 60, pricePerM2: 10000, source: "manual" },
          { date: "2024-02", area: 61, pricePerM2: 12000, source: "manual" },
        ]}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    // The Cśr value also appears in the sidebar's "Statystyki próby" card
    // (same format) — scope to the fixed FootNav bar itself so the two
    // occurrences don't collide in an ambiguous getByText query.
    const footNav = screen.getByRole("link", { name: /wstecz/i }).closest(".fixed") as HTMLElement;
    expect(within(footNav).getByText(/Próba:/)).toBeInTheDocument();
    expect(within(footNav).getByText("2 transakcje")).toBeInTheDocument();
    expect(within(footNav).getByText(/Cśr/)).toBeInTheDocument();
    expect(within(footNav).getByText("11 000,00 zł/m²")).toBeInTheDocument();
  });

  it("FootNav primary button has type=submit", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={null}
        sampleSelection={null}
        streetView={null}
      />,
    );

    const submitButton = screen.getByRole("button", { name: /zatwierdź próbę i dalej/i });
    expect(submitButton).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: /wstecz/i })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=2`,
    );
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
        sampleSelection={null}
        streetView={null}
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
        sampleSelection={null}
        streetView={null}
      />,
    );

    const hint = screen.getByText(/wymaga co najmniej 12 transakcji/i);
    expect(hint.textContent).toMatch(/masz 5/i);
  });
});

describe("StepSample — candidate table (Slice 3)", () => {
  it("renders SampleTable when a v3 selection is present and keeps the editable table collapsed; expands on click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={makeSampleMeta()}
        sampleSelection={makeSampleSelection({ proposed: [makeCandidate()] })}
        streetView={null}
      />,
    );

    // The candidate table renders — its own column header is a reliable,
    // unambiguous marker (the editable table has no "Fasada" column).
    expect(screen.getByText("Fasada")).toBeInTheDocument();

    // Collapsed by default: the editable table's own columns/inputs are
    // absent from the DOM, not merely hidden.
    expect(screen.queryByText("Data transakcji")).toBeNull();
    expect(container.querySelector("#comparable-price-0")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(12\)/ }));

    expect(screen.getByText("Data transakcji")).toBeInTheDocument();
    expect(container.querySelector("#comparable-price-0")).not.toBeNull();
  });

  it("keeps the RCN fetch button visible even while the editable section is collapsed", () => {
    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={makeSampleMeta()}
        sampleSelection={makeSampleSelection({ proposed: [makeCandidate()] })}
        streetView={null}
      />,
    );

    expect(screen.getByRole("button", { name: /pobierz próbę z rcn/i })).toBeVisible();
  });
});

describe("StepSample — manual rejection flow", () => {
  // All five share one building (`maxPerBuilding` = 3, the domain default) —
  // that's what keeps the two extras as ALTERNATES rather than being
  // silently promoted into `proposed` on first render (same fixpoint the
  // sample-table.test.tsx fixtures work around), and what makes the
  // backfill-after-reject assertion below meaningful.
  function buildingCandidate(i: number): Candidate {
    return makeCandidate({
      transactionId: `T-BUILD-${i}`,
      lokalId: `306401_1.0001.34_BUD_5_LOK_${i}`,
      date: `2024-0${i}`,
      pricePerM2: 11000 + i * 10,
      distanceM: 100 + i,
    });
  }

  it("reject from the panel backfills from alternates, persists a manual rejection, and restore reverses it", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockClear();
    pushMock.mockClear();
    saveSampleAction.mockResolvedValue({ ok: true });

    const proposed = [buildingCandidate(1), buildingCandidate(2), buildingCandidate(3)];
    const alternates = [buildingCandidate(4), buildingCandidate(5)];
    const sel = makeSampleSelection({ proposed, alternates });
    // Mirrors what the server ACL actually persists after a fetch (Task 9's
    // `rcnRow`-equivalent mapping) — every row `source: "rcn"`, keyed by the
    // SAME `transactionId` as the matching `Candidate`, so `syncComparables`
    // can tell these apart from a hand-added row later.
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
    }));

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={initialComparables}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    // Alternates collapsed by default: only the 3 proposed rows render.
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(3);

    await user.click(screen.getAllByRole("row").slice(1)[0]);
    await waitFor(() => expect(screen.getByText("Kandydatka 1 z 5")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // proposed stays at 3 — the first former alternate backfilled the slot.
    await waitFor(() => expect(screen.getAllByRole("row").slice(1)).toHaveLength(3));
    expect(screen.getByRole("button", { name: /Odrzucone \(1\)/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));

    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      {
        sampleSelection?: SampleSelectionSnapshot;
        comparables: Array<{ source?: string; transactionId?: string }>;
      },
    ];
    expect(payload.sampleSelection?.manualRejections).toHaveLength(1);
    expect(payload.comparables).toHaveLength(3);
    expect(payload.comparables.every((c) => c.source === "rcn")).toBe(true);
    expect(new Set(payload.comparables.map((c) => c.transactionId))).toEqual(
      new Set([proposed[1].transactionId, proposed[2].transactionId, alternates[0].transactionId]),
    );

    // Restore reverses the rejection.
    await user.click(screen.getByRole("button", { name: /Odrzucone \(1\)/ }));
    await user.click(screen.getByRole("button", { name: /Przywróć/i }));

    saveSampleAction.mockClear();
    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload2] = saveSampleAction.mock.calls.at(-1) as [
      string,
      { sampleSelection?: SampleSelectionSnapshot },
    ];
    expect(payload2.sampleSelection?.manualRejections).toEqual([]);
  });
});

describe("StepSample — radius buttons (Task 8)", () => {
  beforeEach(() => {
    reselectSample.mockReset();
    getSampleProposal.mockClear();
  });

  it("clicking a radius calls reselectSample with radiusOverrideM + the form's manualRejections, then replaces sampleSelection/sampleMeta/streetView and keeps the manual row", async () => {
    const user = userEvent.setup();
    const initialProposed = [
      makeCandidate({ transactionId: "T-OLD-1", pricePerM2: 11000 }),
      makeCandidate({
        transactionId: "T-OLD-2",
        lokalId: "306401_1.0001.34_BUD_5_LOK_7",
        pricePerM2: 11500,
      }),
    ];
    const sel = makeSampleSelection({ proposed: initialProposed, radiusUsedM: 500 });
    const initialComparables: Comparable[] = [
      ...initialProposed.map((c) => ({
        date: c.date,
        area: c.area,
        pricePerM2: c.pricePerM2,
        source: "rcn" as const,
        transactionId: c.transactionId,
      })),
      // A hand-added row, explicitly `source: "manual"` — must survive a
      // radius change untouched (decision 4, 2026-08-21).
      { date: "2020-01", area: 50, pricePerM2: 9000, source: "manual" as const },
    ];

    const newProposed = [
      makeCandidate({ transactionId: "T-NEW-1", pricePerM2: 12000 }),
      makeCandidate({
        transactionId: "T-NEW-2",
        lokalId: "306401_1.0001.34_BUD_5_LOK_8",
        pricePerM2: 12500,
      }),
    ];
    const sel2 = makeSampleSelection({
      proposed: newProposed,
      radiusUsedM: 1000,
      counts: { pool: 9000, afterBand: 90 },
    });
    reselectSample.mockResolvedValue({
      proposal: {
        comparables: newProposed.map((c) => ({
          date: c.date,
          area: c.area,
          pricePerM2: c.pricePerM2,
          transactionId: c.transactionId,
        })),
        sampleSelection: sel2,
        sampleMeta: makeSampleMeta(),
        streetView: makeStreetView(),
      },
    });

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={initialComparables}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    expect(screen.getByRole("button", { name: "500 m" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "1000 m" }));

    await waitFor(() =>
      expect(reselectSample).toHaveBeenCalledWith({
        valuationId: VID,
        radiusOverrideM: 1000,
        manualRejections: [],
      }),
    );

    // Banner reflects the new snapshot's radius/counts.
    await waitFor(() => expect(bannerText(container)).toMatch(/w promieniu 1000 m/));
    expect(screen.getByRole("button", { name: "1000 m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "500 m" })).toHaveAttribute("aria-pressed", "false");

    // The candidate table now shows the NEW rows (T-NEW-1/2), not the old ones.
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(2);

    // The manual row survives untouched — expand the editable table to see it.
    await user.click(screen.getByRole("button", { name: /próba do kalkulacji.*edytuj wartości/i }));
    const prices = screen
      .getAllByPlaceholderText("zł/m²")
      .map((el) => (el as HTMLInputElement).value);
    expect(prices).toEqual(["12000", "12500", "9000"]);
  });

  it("carries manualRejections from the response into the effective (post-rejection) rows saved to the form", async () => {
    const user = userEvent.setup();
    const sel = makeSampleSelection({ radiusUsedM: 500 });
    const initialComparables: Comparable[] = sel.proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
    }));

    const tNew1 = makeCandidate({ transactionId: "T-NEW-1", pricePerM2: 12000 });
    const tNew2 = makeCandidate({
      transactionId: "T-NEW-2",
      lokalId: "306401_1.0001.34_BUD_5_LOK_8",
      pricePerM2: 12500,
    });
    const tNew3 = makeCandidate({
      transactionId: "T-NEW-3",
      lokalId: "306401_1.0001.34_BUD_5_LOK_9",
      pricePerM2: 13000,
    });
    const sel2: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [tNew1, tNew2], alternates: [tNew3], radiusUsedM: 1000 }),
      // T-NEW-1 was manually rejected in a PREVIOUS round and carried over —
      // the effective proposal backfills from alternates (T-NEW-3).
      manualRejections: [
        {
          transactionId: "T-NEW-1",
          lokalId: tNew1.lokalId,
          reason: "too_far",
          at: "2026-08-21T09:00:00Z",
        },
      ],
    };
    reselectSample.mockResolvedValue({
      proposal: {
        comparables: [tNew1, tNew2].map((c) => ({
          date: c.date,
          area: c.area,
          pricePerM2: c.pricePerM2,
          transactionId: c.transactionId,
        })),
        sampleSelection: sel2,
        sampleMeta: makeSampleMeta(),
        streetView: null,
      },
    });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={initialComparables}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "1000 m" }));
    await waitFor(() => expect(reselectSample).toHaveBeenCalled());

    await user.click(
      await screen.findByRole("button", { name: /próba do kalkulacji.*edytuj wartości/i }),
    );
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      // T-NEW-1 (rejected) is absent; T-NEW-2 and the backfilled T-NEW-3 are present.
      expect(prices).toEqual(["12500", "13000"]);
    });
  });

  it("a pool_missing response disables the radius buttons and shows the reason as an alert", async () => {
    const user = userEvent.setup();
    const sel = makeSampleSelection({ radiusUsedM: 500 });
    reselectSample.mockResolvedValue({
      error: "Zmiana promienia wymaga świeżej puli — pobierz próbę z RCN ponownie.",
      code: "pool_missing",
    });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={twelveComparables()}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "1000 m" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/pobierz próbę z rcn ponownie/i),
    );
    for (const r of [500, 1000, 2000, 3000]) {
      expect(screen.getByRole("button", { name: `${r} m` })).toBeDisabled();
    }

    // A fresh, successful "Pobierz próbę z RCN" clears the pool_missing gate.
    const freshSel = makeSampleSelection({ radiusUsedM: 500 });
    getSampleProposal.mockResolvedValue({
      proposal: {
        comparables: freshSel.proposed.map((c) => ({
          date: c.date,
          area: c.area,
          pricePerM2: c.pricePerM2,
          transactionId: c.transactionId,
        })),
        sampleSelection: freshSel,
        sampleMeta: makeSampleMeta(),
        streetView: {},
      },
    });
    await user.click(screen.getByRole("button", { name: /pobierz próbę z rcn/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "500 m" })).not.toBeDisabled());
  });

  /**
   * Review round 1, Important #1 (2026-08-21): the FIRST implementation's
   * radius handler filtered manual rows with `c.source && c.source !==
   * "rcn"`, which silently deleted a row still missing its `source` — the
   * exact shape of a row right after "Dodaj transakcję", before it has been
   * saved once. This pins the fix: the shared `rebuildComparables` helper
   * keeps ANY non-"rcn" row, `source` present or not.
   */
  it("a hand-added row with NO source yet (mid-edit, right after 'Dodaj transakcję') survives a radius change with its typed values", async () => {
    const user = userEvent.setup();
    const initialProposed = [
      makeCandidate({ transactionId: "T-OLD-1", pricePerM2: 11000 }),
      makeCandidate({
        transactionId: "T-OLD-2",
        lokalId: "306401_1.0001.34_BUD_5_LOK_7",
        pricePerM2: 11500,
      }),
    ];
    const sel = makeSampleSelection({ proposed: initialProposed, radiusUsedM: 500 });
    const initialComparables: Comparable[] = initialProposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
    }));

    const newProposed = [
      makeCandidate({ transactionId: "T-NEW-1", pricePerM2: 20000 }),
      makeCandidate({
        transactionId: "T-NEW-2",
        lokalId: "306401_1.0001.34_BUD_5_LOK_8",
        pricePerM2: 20500,
      }),
    ];
    const sel2 = makeSampleSelection({ proposed: newProposed, radiusUsedM: 1000 });
    reselectSample.mockResolvedValue({
      proposal: {
        comparables: newProposed.map((c) => ({
          date: c.date,
          area: c.area,
          pricePerM2: c.pricePerM2,
          transactionId: c.transactionId,
        })),
        sampleSelection: sel2,
        sampleMeta: makeSampleMeta(),
        streetView: null,
      },
    });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={initialComparables}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    // Expand the editable table, then add a row by hand (no `source` set —
    // exactly what "Dodaj transakcję" produces before any save round-trip).
    await user.click(screen.getByRole("button", { name: /próba do kalkulacji.*edytuj wartości/i }));
    await user.click(screen.getByRole("button", { name: /dodaj transakcję/i }));

    const dateInputs = screen.getAllByPlaceholderText("2024-07");
    const areaInputs = screen.getAllByPlaceholderText("m²");
    const priceInputs = screen.getAllByPlaceholderText("zł/m²");
    const handIndex = priceInputs.length - 1;
    await user.type(dateInputs[handIndex], "2020-01");
    await user.type(areaInputs[handIndex], "50");
    await user.type(priceInputs[handIndex], "9000");

    await user.click(screen.getByRole("button", { name: "1000 m" }));
    await waitFor(() => expect(reselectSample).toHaveBeenCalled());

    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      // RCN rows replaced by the new pool; the hand-added row (no `source`)
      // survives untouched, kept AFTER the RCN rows.
      expect(prices).toEqual(["20000", "20500", "9000"]);
    });
    const dates = screen
      .getAllByPlaceholderText("2024-07")
      .map((el) => (el as HTMLInputElement).value);
    expect(dates.at(-1)).toBe("2020-01");
    const areas = screen.getAllByPlaceholderText("m²").map((el) => (el as HTMLInputElement).value);
    expect(areas.at(-1)).toBe("50");
  });
});
