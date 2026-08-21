// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Comparable, SampleMeta } from "@/domain/kcs";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { candidateKey, type Candidate } from "@/domain/sample-selection";
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

// The overview map has its own RTL suite (rtl-sample-map-leaflet.test.tsx);
// here only its presence/absence matters, and Leaflet is client-only.
vi.mock("@/app/valuations/[id]/steps/sample-map", () => ({
  SampleMap: () => <figure data-testid="sample-map" />,
}));

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

describe("StepSample — overview map (Task 9)", () => {
  it("renders between the radius buttons and the candidate table when a v3 selection carries a subject point", () => {
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

    expect(screen.getByTestId("sample-map")).toBeInTheDocument();
  });

  it("is absent without a persisted sampleMeta (no subject point to centre it on)", () => {
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

    expect(screen.queryByTestId("sample-map")).toBeNull();
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

    // "W próbie" has 3 rows regardless of the "Alternatywy" section's own
    // (unrelated) default-expand state — scoped by testid, not a raw row
    // count, since Slice 3c splits the candidate table into two sections.
    expect(screen.getAllByTestId("proposed-row")).toHaveLength(3);

    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 1 z 5 · przejrzane 0")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // proposed stays at 3 — the first former alternate backfilled the slot.
    await waitFor(() => expect(screen.getAllByTestId("proposed-row")).toHaveLength(3));
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
      {
        sampleSelection?: SampleSelectionSnapshot;
        comparables: Array<{ source?: string; transactionId?: string }>;
      },
    ];
    expect(payload2.sampleSelection?.manualRejections).toEqual([]);
    // Restore re-asserts `comparables` too (T7 #1–#3), not just the
    // selection snapshot — back to the original 3 proposed rows, the
    // backfilled alternate gone.
    expect(payload2.comparables).toHaveLength(3);
    expect(new Set(payload2.comparables.map((c) => c.transactionId))).toEqual(
      new Set(proposed.map((c) => c.transactionId)),
    );
  });

  it("post-reject selection follows the SAME ranking slot to whoever backfilled it ('Propozycja 1 z 4 · przejrzane 1' after rejecting the first of 5)", async () => {
    const user = userEvent.setup();
    const proposed = [buildingCandidate(1), buildingCandidate(2), buildingCandidate(3)];
    const alternates = [buildingCandidate(4), buildingCandidate(5)];
    const sel = makeSampleSelection({ proposed, alternates });
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

    // Reject the FIRST proposed row ("W próbie" section, testid-scoped —
    // Slice 3c splits the candidate table into two sections).
    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 1 z 5 · przejrzane 0")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // Total drops from 5 to 4 (the rejected candidate leaves both lists);
    // the panel stays on the SAME slot (index 0), now showing whoever
    // backfilled it.
    // The just-rejected row is itself marked reviewed (rejecting IS
    // reviewing it) — the title now carries the "przejrzane" counter.
    await waitFor(() =>
      expect(screen.getByText("Propozycja 1 z 4 · przejrzane 1")).toBeInTheDocument(),
    );
  });

  it("'Zostaw' (and Enter, which routes to the identical onKeep callback — see rtl-sample-panel.test.tsx) advances through the ranking and closes the panel past the last candidate", async () => {
    const user = userEvent.setup();
    const sel = makeSampleSelection({
      proposed: [makeCandidate({ transactionId: "T-ONLY-1" })],
      alternates: [
        makeCandidate({ transactionId: "T-ONLY-2", lokalId: "306401_1.0001.34_BUD_5_LOK_9" }),
      ],
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

    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    await user.click(within(candidateTable()).getAllByRole("row").slice(1)[0]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 1 z 2 · przejrzane 0")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Zostaw" }));
    // "Zostaw" marks the row reviewed before advancing (Slice 3c, Task 5) —
    // the title on the NEXT candidate already shows "przejrzane 1".
    await waitFor(() =>
      expect(screen.getByText("Propozycja 2 z 2 · przejrzane 1")).toBeInTheDocument(),
    );

    // Past the last candidate: the panel closes rather than showing a
    // dangling "Propozycja 3 z 2".
    await user.click(screen.getByRole("button", { name: "Zostaw" }));
    await waitFor(() => expect(screen.queryByText(/Propozycja \d+ z \d+/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Zostaw" })).toBeNull();
  });

  it("an edited RCN row's price survives reject, restore, and a radius change (final wave A1)", async () => {
    const user = userEvent.setup();
    reselectSample.mockReset();

    const A = buildingCandidate(1);
    const B = buildingCandidate(2);
    const C = buildingCandidate(3);
    const D = buildingCandidate(4);
    const proposed = [A, B, C];
    const alternates = [D, buildingCandidate(5)];
    const sel = makeSampleSelection({ proposed, alternates });
    // lokalId carried through (wave 4): matches what `step-sample.tsx`'s
    // hydration actually produces for a CURRENT draft — this test is about
    // the happy path (A1), not the legacy pre-lokalId fallback, which has
    // its own dedicated describe block below and cannot preserve an edit.
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
      lokalId: c.lokalId,
    }));

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

    // Expand the editable table and edit row A's (index 0) price.
    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(3\)/ }));
    const priceA = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceA);
    await user.type(priceA, "77777");
    expect(priceA.value).toBe("77777");

    // Reject row B — scoped by testid to the "W próbie" section (distinct
    // from both the now-expanded editable table AND the "Alternatywy"
    // section, which also has role="row" elements).
    await user.click(screen.getAllByTestId("proposed-row")[1]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 2 z 5 · przejrzane 0")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // A's edit survives the resync; the backfilled alternate (D) prints its own RCN price.
    await waitFor(() =>
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "77777",
      ),
    );
    expect((container.querySelector("#comparable-price-1") as HTMLInputElement).value).toBe(
      String(C.pricePerM2),
    );
    expect((container.querySelector("#comparable-price-2") as HTMLInputElement).value).toBe(
      String(D.pricePerM2),
    );

    // Restore B — A's edit still survives; B comes back with its own (never
    // edited) RCN price; D drops out — it LEFT the proposal, so it isn't
    // kept as a stray extra row.
    await user.click(screen.getByRole("button", { name: /Odrzucone \(1\)/ }));
    await user.click(screen.getByRole("button", { name: /Przywróć/i }));

    await waitFor(() =>
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "77777",
      ),
    );
    expect((container.querySelector("#comparable-price-1") as HTMLInputElement).value).toBe(
      String(B.pricePerM2),
    );
    expect((container.querySelector("#comparable-price-2") as HTMLInputElement).value).toBe(
      String(C.pricePerM2),
    );
    expect(container.querySelector("#comparable-price-3")).toBeNull();

    // A (mocked) radius click: A's edit still survives; a brand-new
    // candidate (F, never seen before) prints its own fresh RCN price.
    const F = buildingCandidate(6);
    const sel2 = makeSampleSelection({ proposed: [A, C, F], radiusUsedM: 1000 });
    reselectSample.mockResolvedValue({
      proposal: {
        comparables: [A, C, F].map((c) => ({
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

    await user.click(screen.getByRole("button", { name: "1000 m" }));
    await waitFor(() => expect(reselectSample).toHaveBeenCalled());

    await waitFor(() =>
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "77777",
      ),
    );
    expect((container.querySelector("#comparable-price-1") as HTMLInputElement).value).toBe(
      String(C.pricePerM2),
    );
    expect((container.querySelector("#comparable-price-2") as HTMLInputElement).value).toBe(
      String(F.pricePerM2),
    );
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
        manualInclusions: [],
        reviewed: [],
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

describe("StepSample — multi-lokal act (final wave runtime fix, Heweliusza 3/43)", () => {
  it("two lokale sharing one transactionId keep their OWN area/price across a reject; editing one leaves the other untouched", async () => {
    const user = userEvent.setup();
    // Same building (default `makeCandidate` egib) so all four candidates
    // compete for the same maxPerBuilding=3 slots — lokalA/lokalB share ONE
    // transactionId (one notarial act carrying two lokale), "other" and
    // "backfill" are separate acts.
    const lokalA = makeCandidate({
      transactionId: "ACT-SHARED",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const lokalB = makeCandidate({
      transactionId: "ACT-SHARED",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const backfill = makeCandidate({
      transactionId: "T-BACKFILL",
      lokalId: "306401_1.0001.34_BUD_5_LOK_D",
      pricePerM2: 8800,
      area: 44,
      distanceM: 103,
    });
    const proposed = [lokalA, lokalB, other];
    const alternates = [backfill];
    const sel = makeSampleSelection({ proposed, alternates });
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
      lokalId: c.lokalId,
    }));

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

    // Reject the THIRD candidate ("other") — lokalA/lokalB (the shared act)
    // must BOTH keep their own price/area, never collapse onto one of them.
    // testid-scoped to "W próbie" (Slice 3c splits the candidate table into
    // two sections) — proposed stays at 3 rows both before and after the
    // reject below, so index 2 keeps meaning "the third proposed row".
    await user.click(screen.getAllByTestId("proposed-row")[2]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 3 z 4 · przejrzane 0")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(3\)/ }));
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["7505.43", "7541.24", String(backfill.pricePerM2)]);
    });

    // Edit lokal A's price, then reject the backfilled candidate — A keeps
    // its edit, B is untouched (not overwritten by A's edit, not reset).
    const priceA = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceA);
    await user.type(priceA, "99999");

    await user.click(screen.getAllByTestId("proposed-row")[2]); // the backfilled candidate now occupies slot 3
    // The first reject already marked one row reviewed — carries through.
    await waitFor(() =>
      expect(screen.getByText("Propozycja 3 z 3 · przejrzane 1")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await waitFor(() =>
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "99999",
      ),
    );
    expect((container.querySelector("#comparable-price-1") as HTMLInputElement).value).toBe(
      "7541.24",
    );
    // The rejected backfill left the proposal — not kept as a stray row.
    expect(container.querySelector("#comparable-price-2")).toBeNull();
  });

  it("legacy rows (no lokalId, pre-fix draft) sharing one transactionId are matched by CONTENT, not position — not collapsed (C1 refinement, updated wave 4)", async () => {
    const user = userEvent.setup();
    const lokalA = makeCandidate({
      transactionId: "ACT-LEGACY",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const lokalB = makeCandidate({
      transactionId: "ACT-LEGACY",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-2",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const proposed = [lokalA, lokalB, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    // LEGACY rows: source "rcn" + transactionId, but NO lokalId — simulates
    // a draft saved before this field existed on the form row. Two rows
    // share ACT-LEGACY with DIFFERENT content (own price/area) — exactly
    // what matchLegacyRow needs to tell them apart without lokalId or
    // position (wave 4).
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

    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);

    // Reject "other" — forces a resync; the two legacy ACT-LEGACY rows must
    // land back correctly matched to their OWN content (A's price at slot
    // 0, B's at slot 1), never collapsed onto whichever one happens to
    // occupy a shared bucket.
    await user.click(candidateRows()[2]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 3 z 3 · przejrzane 0")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(2\)/ }));
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["7505.43", "7541.24"]);
    });
  });
});

/**
 * Wave 4 — C1 was still open on the RELOADED-DRAFT path (Opus re-review,
 * fixture heweliusza, act …439017 BUD.170/171). Root cause:
 * `step-sample.tsx`'s hydration mapped `initialComparables` through an
 * explicit 5-field literal that DROPPED `lokalId`, so after any page load
 * every RCN row looked "legacy" and `rebuildComparables` fell to its
 * position-sensitive fallback (the old per-transactionId FIFO queue) —
 * which could hand a candidate the WRONG lokal's data specifically when the
 * FIRST lokal of an act was rejected (repro: reject A → B's row got A's
 * 50,63 m² / 7505,43 zł). Fixed both ends: `step-sample.tsx` now carries
 * `lokalId` through hydration, and the legacy fallback matches by CONTENT
 * (`matchLegacyRow`, `use-sample-review.test.ts`), never by position.
 */
describe("StepSample — reload path (wave 4): lokalId survives draft hydration", () => {
  const setUp = () => {
    const lokalA = makeCandidate({
      transactionId: "ACT-RELOAD",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const lokalB = makeCandidate({
      transactionId: "ACT-RELOAD",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-RELOAD",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const proposed = [lokalA, lokalB, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    // `comparables` mirrors the SERVER's `Comparable` shape (`StepSample`'s
    // own prop type) — lokalId included, exactly what a CURRENT draft's
    // saved row carries. If `step-sample.tsx`'s hydration ever dropped
    // lokalId again, this test would regress right along with it.
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
      lokalId: c.lokalId,
    }));
    return { sel, initialComparables };
  };

  async function rejectPanelRow(user: ReturnType<typeof userEvent.setup>, index: number) {
    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);
    await user.click(candidateRows()[index]);
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));
  }

  it("edit B's price, then reject the FIRST lokal of the act (A) → B's EDIT survives on its OWN row, not A's fresh price (repro: reject A → B got A's 50,63/7505,43)", async () => {
    const user = userEvent.setup();
    const { sel, initialComparables } = setUp();
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
    // Only the candidateKey path (hydrated lokalId) can carry an EDIT
    // through a resync — content-matching/regeneration can't (see the
    // legacy describe block below), so editing B here is what actually
    // discriminates "hydration carries lokalId" from "got the right price
    // by chance". B is index 1 (A, B, other).
    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(3\)/ }));
    const priceB = container.querySelector("#comparable-price-1") as HTMLInputElement;
    await user.clear(priceB);
    await user.type(priceB, "88888");
    await rejectPanelRow(user, 0); // lokalA
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["88888", "9000"]); // B's EDIT, never A's data
    });
  });

  it("edit A's price, then reject the SECOND lokal of the act (B) instead — fresh render, symmetric case — A's EDIT survives on its OWN row, not B's fresh price", async () => {
    const user = userEvent.setup();
    const { sel, initialComparables } = setUp();
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
    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(3\)/ }));
    const priceA = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceA);
    await user.type(priceA, "77777");
    await rejectPanelRow(user, 1); // lokalB
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["77777", "9000"]); // A's EDIT, never B's data
    });
  });
});

describe("StepSample — legacy draft path (wave 4): rows without lokalId are matched by content, never position", () => {
  it("reject the FIRST lokal of a legacy act (A) → the SECOND (B) keeps its OWN area/price, matched by content — the exact repro this wave fixed", async () => {
    const user = userEvent.setup();
    const lokalA = makeCandidate({
      transactionId: "ACT-LEGACY-2",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const lokalB = makeCandidate({
      transactionId: "ACT-LEGACY-2",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-LEGACY-2",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const proposed = [lokalA, lokalB, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    // LEGACY rows: no lokalId at all — the pre-lokalId draft shape.
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

    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);
    await user.click(candidateRows()[0]); // lokalA
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(2\)/ }));
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["7541.24", "9000"]); // B's own price, never A's
    });
  });

  it("an EDITED legacy row of a SINGLE-lokal act SURVIVES a resync (wave 5) — a lone row for a transactionId can't be confused with another lokal, so it needs no content match", async () => {
    const user = userEvent.setup();
    const single = makeCandidate({
      transactionId: "ACT-SINGLE-LEGACY",
      lokalId: "306401_1.0001.34_BUD_5_LOK_S",
      pricePerM2: 7000,
      area: 40,
      distanceM: 100,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-LEGACY-3",
      lokalId: "306401_1.0001.34_BUD_5_LOK_D",
      pricePerM2: 9000,
      area: 45,
      distanceM: 101,
    });
    const proposed = [single, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
    }));

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

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(2\)/ }));
    const priceSingle = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceSingle);
    await user.type(priceSingle, "12345");

    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);
    // Reject the OTHER candidate — forces a resync that touches every row,
    // including "single"'s, even though "single" itself isn't the one
    // rejected.
    await user.click(candidateRows()[1]);
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await waitFor(() => {
      // The edit ("12345") SURVIVES (wave 5) — "single" is the ONLY legacy
      // row for its transactionId, so matchLegacyRow reuses it as-is
      // without needing a content match at all. Only a genuinely AMBIGUOUS
      // multi-lokal act (2+ rows for one transactionId) still trades an
      // edit for correctness — see the "edited legacy row of a
      // multi-lokal act" test below.
      expect((container.querySelector("#comparable-price-0") as HTMLInputElement).value).toBe(
        "12345",
      );
    });
  });

  it("an EDITED legacy row of a genuinely AMBIGUOUS multi-lokal act (2+ rows sharing one transactionId) is REGENERATED (edit lost) on the next resync — wave 5's accepted trade-off, narrowed to this exact case", async () => {
    const user = userEvent.setup();
    const lokalA = makeCandidate({
      transactionId: "ACT-AMBIGUOUS-LEGACY",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const lokalB = makeCandidate({
      transactionId: "ACT-AMBIGUOUS-LEGACY",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-LEGACY-4",
      lokalId: "306401_1.0001.34_BUD_5_LOK_E",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const proposed = [lokalA, lokalB, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    // LEGACY rows: two share ACT-AMBIGUOUS-LEGACY — a genuine multi-lokal
    // act, the case content-matching still has to arbitrate.
    const initialComparables: Comparable[] = proposed.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
    }));

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

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(3\)/ }));
    const priceA = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceA);
    await user.type(priceA, "12345");

    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);
    // Reject "other" — forces a resync touching every row.
    await user.click(candidateRows()[2]);
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    await waitFor(() => {
      // A's edit is GONE — regenerated to A's own fresh price (7505.43),
      // never B's (7541.24). B, unedited, still gets its own fresh price
      // too (content-matched or regenerated — either way, correct).
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["7505.43", "7541.24"]);
    });
  });
});

/**
 * Wave 6 — the Opus re-review proved a gap in wave 5's single-row shortcut:
 * ONE legacy row for an act, but TWO candidates of that act in the
 * effective proposal — the shortcut fired for BOTH independent
 * `matchLegacyRow` calls (each saw the same 1-row array), so both
 * candidates received the SAME row object (B printed A's data — the
 * original C1 shape). Fixed by (1) disabling the shortcut whenever 2+
 * candidates share a transactionId (content decides instead) and (2)
 * consuming a claimed row from a shared pool so it can never satisfy a
 * second candidate either way.
 */
describe("StepSample — legacy draft path (wave 6): one legacy row, two candidates of the same act", () => {
  async function rejectOther(user: ReturnType<typeof userEvent.setup>, index: number) {
    const candidateTable = () => screen.getByText("Fasada").closest("table")!;
    const candidateRows = () => within(candidateTable()).getAllByRole("row").slice(1);
    await user.click(candidateRows()[index]);
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));
  }

  it("A first in the proposal: the single legacy row (A's own content) goes to A; B — never seeing that row — regenerates its OWN data, never A's", async () => {
    const user = userEvent.setup();
    const A = makeCandidate({
      transactionId: "ACT-1ROW-2CAND",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const B = makeCandidate({
      transactionId: "ACT-1ROW-2CAND",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-1ROW",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    const proposed = [A, B, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    // LEGACY, and only ONE row for the shared act — simulates a draft
    // saved when only A was in the proposal; B has since entered it too
    // (e.g. a radius/reselect change). No lokalId on either row.
    const initialComparables: Comparable[] = [A, other].map((c) => ({
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

    // Reject "other" — forces a resync where nextEff.proposed = [A, B],
    // both sharing ACT-1ROW-2CAND, with only ONE legacy row for it.
    await rejectOther(user, 2);

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(2\)/ }));
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      expect(prices).toEqual(["7505.43", "7541.24"]); // A's own row, B's own fresh data
      expect(prices[0]).not.toBe(prices[1]); // never the same value/object twice
    });
  });

  it("B first in the proposal (symmetric order) — the same single legacy row still finds A by content, never B; order doesn't change which candidate is correct", async () => {
    const user = userEvent.setup();
    const A = makeCandidate({
      transactionId: "ACT-1ROW-2CAND-B",
      lokalId: "306401_1.0001.34_BUD_5_LOK_A2",
      pricePerM2: 7505.43,
      area: 50.63,
      distanceM: 100,
    });
    const B = makeCandidate({
      transactionId: "ACT-1ROW-2CAND-B",
      lokalId: "306401_1.0001.34_BUD_5_LOK_B2",
      pricePerM2: 7541.24,
      area: 38.19,
      distanceM: 101,
    });
    const other = makeCandidate({
      transactionId: "T-OTHER-1ROW-B",
      lokalId: "306401_1.0001.34_BUD_5_LOK_C2",
      pricePerM2: 9000,
      area: 45,
      distanceM: 102,
    });
    // B ranks AHEAD of A this time — the domain's own ordering, not test bias.
    const proposed = [B, A, other];
    const sel = makeSampleSelection({ proposed, alternates: [] });
    const initialComparables: Comparable[] = [A, other].map((c) => ({
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

    await rejectOther(user, 2);

    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(2\)/ }));
    await waitFor(() => {
      const prices = screen
        .getAllByPlaceholderText("zł/m²")
        .map((el) => (el as HTMLInputElement).value);
      // B is processed FIRST now (proposal order = claim order), but the
      // row's content is A's — B still regenerates its own fresh data,
      // A still gets the row. Same correct outcome, opposite order.
      expect(prices).toEqual(["7541.24", "7505.43"]); // B first, then A
      expect(prices[0]).not.toBe(prices[1]);
    });
  });
});

describe("StepSample — Slice 3c sections integration (Task 5)", () => {
  beforeEach(() => {
    saveSampleAction.mockClear();
    reselectSample.mockReset();
  });

  /** Maps a `Candidate` to the `Comparable` shape a saved draft's `comparables` carries for it (mirrors the other describe blocks in this file). */
  function rcnComparable(c: Candidate): Comparable {
    return {
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "rcn" as const,
      transactionId: c.transactionId,
      lokalId: c.lokalId,
    };
  }

  it("(a) checking an alternate's checkbox includes it — 'W próbie (13)', 13 RCN rows in the save payload, manualInclusions 1, reviewed contains the key", async () => {
    const user = userEvent.setup();
    saveSampleAction.mockResolvedValue({ ok: true });
    const proposed = Array.from({ length: 12 }, (_, i) =>
      makeCandidate({ transactionId: `T-P-${i}`, lokalId: `L-P-${i}` }),
    );
    const alt = makeCandidate({ transactionId: "T-ALT", lokalId: "L-ALT", pricePerM2: 15000 });
    const sel = makeSampleSelection({ proposed, alternates: [alt] });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={proposed.map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const altTable = screen.getByRole("table", { name: "Alternatywy" });
    await user.click(within(altTable).getByRole("checkbox", { name: /^Dodaj do próby/ }));

    await waitFor(() => expect(screen.getByText("W próbie (13)")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      {
        comparables: Array<{ source?: string }>;
        sampleSelection?: SampleSelectionSnapshot;
      },
    ];
    expect(payload.comparables.filter((c) => c.source === "rcn")).toHaveLength(13);
    expect(payload.sampleSelection?.manualInclusions).toHaveLength(1);
    expect(
      payload.sampleSelection?.reviewed?.some((r) => candidateKey(r) === candidateKey(alt)),
    ).toBe(true);
  });

  it("(b) unchecking a proposed row opens the panel already in the rejection-reasons state; confirming moves it to Odrzucone, backfills, reviewed reaches 2", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    // A third proposed row keeps `comparables` at ≥3 after p1 is rejected —
    // the min-3 zod gate would otherwise block submit regardless of this
    // test's own subject (the "reviewed reaches 2" round-trip).
    const p3 = makeCandidate({ transactionId: "T-P3", lokalId: "L-P3" });
    const alt1 = makeCandidate({ transactionId: "T-ALT1", lokalId: "L-ALT1" });
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2, p3], alternates: [alt1] }),
      // p2 already reviewed BEFORE this test's own action — isolates "the
      // count reaches 2" from "there happen to be 2 actions in this test".
      reviewed: [
        { transactionId: p2.transactionId, lokalId: p2.lokalId, at: "2026-08-20T10:00:00Z" },
      ],
    };

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2, p3].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    // p1 is the FIRST "W próbie" row (ranking order) — uncheck it.
    await user.click(within(proposedTable).getAllByRole("checkbox")[0]);

    // initialRejecting skips the extra "Odrzuć" click — reasons UI already open.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // p1 left "W próbie" — alt1 (unflagged, a free slot at mount already
    // promoted it there — see the flagged fixtures elsewhere in this file)
    // stays, so the section drops from 4 to 3, not further.
    await waitFor(() => expect(screen.getByText("W próbie (3)")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Odrzucone \(1\)/ })).toBeInTheDocument();

    saveSampleAction.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      {
        sampleSelection?: SampleSelectionSnapshot;
        comparables: Array<{ transactionId?: string }>;
      },
    ];
    expect(payload.sampleSelection?.reviewed).toHaveLength(2);
    // p1 truly left the sample — 3 comparables, none of them p1's.
    expect(payload.comparables).toHaveLength(3);
    expect(payload.comparables.some((c) => c.transactionId === "T-P1")).toBe(false);
  });

  it("(c) 'Pomiń' on an alternate (from the panel) marks it reviewed — ✓ in the table, sample unchanged, banner shows przejrzane 1/N", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const alt1 = makeCandidate({ transactionId: "T-ALT1", lokalId: "L-ALT1" });
    // Demoted so the domain's own backfill (proposed.length 1 < proposedN
    // 12) doesn't silently promote it into "W próbie" before this test ever
    // touches it — mirrors the same fixpoint workaround `rtl-sample-sections
    // .test.tsx`/`rtl-sample-map.test.tsx` use.
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1], alternates: [alt1] }),
      flags: { [candidateKey(alt1)]: ["price_outlier"] },
    };

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const altTable = screen.getByRole("table", { name: "Alternatywy" });
    const altRow = within(altTable).getAllByRole("row").slice(1)[0];
    await user.click(altRow);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pomiń" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Pomiń" }));

    // Scoped to the ROW (not the whole table) — the "✓" COLUMN HEADER also
    // carries `aria-label="przejrzane"`, so a table-wide query is ambiguous.
    await waitFor(() => expect(within(altRow).getByLabelText("przejrzane")).toBeInTheDocument());
    expect(screen.getByText("W próbie (1)")).toBeInTheDocument();
    expect(bannerText(container)).toMatch(/przejrzane 1\//);
  });

  it("(d) reload with persisted reviewed/manualInclusions: rebuilds sections with ✓ + the 'dodana ręcznie' badge, Alternatywy starts collapsed", () => {
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const included = makeCandidate({ transactionId: "T-INC", lokalId: "L-INC" });
    const alt1 = makeCandidate({ transactionId: "T-ALT1", lokalId: "L-ALT1" });
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1], alternates: [alt1] }),
      // Demoted so alt1 stays a genuine alternate — the domain's own
      // backfill (proposed.length 1 < proposedN 12) would otherwise
      // silently promote it into "proposed" before the overlay even runs.
      flags: { [candidateKey(alt1)]: ["price_outlier"] },
      manualInclusions: [
        {
          transactionId: included.transactionId,
          lokalId: included.lokalId,
          at: "2026-08-20T09:00:00Z",
          candidate: included,
        },
      ],
      reviewed: [
        { transactionId: p1.transactionId, lokalId: p1.lokalId, at: "2026-08-20T09:00:00Z" },
      ],
    };

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, included].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    // p1 (ranked) + included (reattached) — reviewed > 0, so Alternatywy stays collapsed.
    expect(screen.getByText("W próbie (2)")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Alternatywy" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Alternatywy \(1\)/, expanded: false }),
    ).toBeInTheDocument();

    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    // `role: "img"` excludes the "✓" COLUMN HEADER (also `aria-label=
    // "przejrzane"`, but no `role="img"`) — only the check-mark svg counts.
    expect(within(proposedTable).getAllByRole("img", { name: "przejrzane" })).toHaveLength(1);
    expect(within(proposedTable).getByText("dodana ręcznie")).toBeInTheDocument();
  });

  it("radius change carries manualInclusions/reviewed forward: an out-of-radius inclusion stays in 'W próbie', badged 'dodana ręcznie'", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const alt1 = makeCandidate({ transactionId: "T-ALT1", lokalId: "L-ALT1" });
    // alt1 demoted so the domain's own backfill doesn't silently promote it
    // into "W próbie" before the checkbox click this test exercises.
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2], alternates: [alt1], radiusUsedM: 500 }),
      flags: { [candidateKey(alt1)]: ["price_outlier"] },
    };

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const altTable = screen.getByRole("table", { name: "Alternatywy" });
    await user.click(within(altTable).getByRole("checkbox", { name: /^Dodaj do próby/ }));
    await waitFor(() => expect(screen.getByText("W próbie (3)")).toBeInTheDocument());

    // The server-side re-run (mocked here) no longer finds alt1 within the
    // new radius — `buildProposal` re-injects `manualInclusions`/`reviewed`
    // into the fresh snapshot exactly as it does `manualRejections` today.
    // p1/p2 stay in the new proposal (still ≥3 comparables after the
    // re-attach, clearing the min-3 zod gate for the submit below).
    const newSel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2], alternates: [], radiusUsedM: 1000 }),
      manualInclusions: [
        {
          transactionId: alt1.transactionId,
          lokalId: alt1.lokalId,
          at: "2026-08-21T10:00:00Z",
          candidate: alt1,
        },
      ],
      reviewed: [
        { transactionId: alt1.transactionId, lokalId: alt1.lokalId, at: "2026-08-21T10:00:00Z" },
      ],
    };
    reselectSample.mockResolvedValue({
      proposal: {
        comparables: [p1, p2].map((c) => ({
          date: c.date,
          area: c.area,
          pricePerM2: c.pricePerM2,
          transactionId: c.transactionId,
        })),
        sampleSelection: newSel,
        sampleMeta: makeSampleMeta(),
        // `{}`, never `null` — mirrors what `_build-proposal.ts` actually
        // returns (`valuation.inputs?.streetView ?? {}`); `streetViewSchema`
        // is `z.record(...).optional()`, which accepts `undefined` but NOT
        // `null` — a `null` here would silently fail submit validation with
        // no visible alert (the JSX only checks `errors.sampleMeta` /
        // `errors.sampleSelection`, not `errors.streetView`).
        streetView: {},
      },
    });

    await user.click(screen.getByRole("button", { name: "1000 m" }));
    await waitFor(() => expect(reselectSample).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByText("W próbie (3)")).toBeInTheDocument());
    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    expect(within(proposedTable).getByText("dodana ręcznie")).toBeInTheDocument();
    // The reviewed mark on alt1 (carried by the mocked reselect response,
    // same as manualInclusions) survives the radius change too.
    expect(bannerText(container)).toMatch(/przejrzane 1\/3/);

    saveSampleAction.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      { comparables: Array<{ transactionId?: string }> },
    ];
    expect(payload.comparables.some((c) => c.transactionId === alt1.transactionId)).toBe(true);
  });

  it("(f) gate A1: a manually-included alternate + an edited price survive rejecting a DIFFERENT candidate, 1:1", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1", pricePerM2: 11000 });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2", pricePerM2: 11500 });
    // A third proposed row keeps `comparables` at ≥3 after p2 is rejected
    // below — the min-3 zod gate would otherwise block the final submit.
    const p3 = makeCandidate({ transactionId: "T-P3", lokalId: "L-P3", pricePerM2: 11800 });
    const alt1 = makeCandidate({ transactionId: "T-ALT1", lokalId: "L-ALT1", pricePerM2: 15000 });
    // alt1 demoted so the domain's own backfill doesn't silently promote it
    // into "W próbie" before the checkbox click this test exercises.
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2, p3], alternates: [alt1] }),
      flags: { [candidateKey(alt1)]: ["price_outlier"] },
    };

    const { container } = render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2, p3].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    // Add alt1 to the sample via the checkbox.
    const altTable = screen.getByRole("table", { name: "Alternatywy" });
    await user.click(within(altTable).getByRole("checkbox", { name: /^Dodaj do próby/ }));
    await waitFor(() => expect(screen.getByText("W próbie (4)")).toBeInTheDocument());

    // Edit p1's price by hand.
    await user.click(screen.getByRole("button", { name: /Próba do kalkulacji \(4\)/ }));
    const priceP1 = container.querySelector("#comparable-price-0") as HTMLInputElement;
    await user.clear(priceP1);
    await user.type(priceP1, "77777");

    // Reject p2 — a DIFFERENT candidate than the one just edited or included.
    await user.click(screen.getAllByTestId("proposed-row")[1]);
    await waitFor(() => expect(screen.getByText(/^Propozycja/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    await user.click(screen.getByLabelText(/budynek starszy/i));
    await user.click(screen.getByRole("button", { name: /Potwierdź odrzucenie/i }));

    // p1's edit, p3, and alt1's inclusion all survive — no alternates left
    // to backfill p2's slot, so "W próbie" drops from 4 to 3.
    await waitFor(() => expect(screen.getByText("W próbie (3)")).toBeInTheDocument());
    const prices = screen
      .getAllByPlaceholderText("zł/m²")
      .map((el) => (el as HTMLInputElement).value);
    expect(prices).toEqual(["77777", String(p3.pricePerM2), String(alt1.pricePerM2)]);

    saveSampleAction.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: /zatwierdź próbę i dalej/i }));
    await waitFor(() => expect(saveSampleAction).toHaveBeenCalled());
    const [, payload] = saveSampleAction.mock.calls.at(-1) as [
      string,
      { comparables: Array<{ pricePerM2?: number; transactionId?: string }> },
    ];
    // `comparableSchema.pricePerM2` is `z.coerce.number()` — the SAVED
    // payload carries numbers, unlike the raw `<input>` string values above.
    expect(payload.comparables).toEqual([
      expect.objectContaining({ pricePerM2: 77777, transactionId: "T-P1" }),
      expect.objectContaining({ pricePerM2: p3.pricePerM2, transactionId: "T-P3" }),
      expect.objectContaining({ pricePerM2: alt1.pricePerM2, transactionId: "T-ALT1" }),
    ]);
  });

  it("(g) clicking a manually-rejected row in Odrzucone opens the panel with the reason; Przywróć moves it back to W próbie", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const rejected = makeCandidate({ transactionId: "T-REJ", lokalId: "L-REJ" });
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2, rejected], alternates: [] }),
      manualRejections: [
        {
          transactionId: rejected.transactionId,
          lokalId: rejected.lokalId,
          reason: "too_far",
          note: "test note",
          at: "2026-08-20T09:00:00Z",
        },
      ],
    };

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    expect(screen.getByText("W próbie (2)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Odrzucone \(1\)/ }));
    await user.click(screen.getByRole("button", { name: /Podgląd odrzuconej propozycji/i }));

    await waitFor(() => expect(screen.getByText("Odrzucona propozycja")).toBeInTheDocument());
    // "za daleko"/the note text also appear in the still-expanded "Odrzucone"
    // list row itself — scope to the panel's own rejection block to disambiguate.
    const rejectionBlock = screen.getByText(/Powód odrzucenia:/).closest("div")!;
    expect(rejectionBlock.textContent).toMatch(/za daleko/);
    expect(rejectionBlock.textContent).toMatch(/test note/);

    // The still-expanded "Odrzucone" list ALSO has its own inline "Przywróć"
    // button — scope to the panel (the SectionCard around "Odrzucona
    // propozycja") to disambiguate.
    const panelSection = screen.getByText("Odrzucona propozycja").closest("section")!;
    await user.click(within(panelSection).getByRole("button", { name: "Przywróć" }));

    await waitFor(() => expect(screen.getByText("W próbie (3)")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Odrzucone \(0\)/ })).toBeInTheDocument();
  });

  it("the panel header shows the review counter — 'Propozycja N z M · przejrzane R'", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const sel: SampleSelectionSnapshot = {
      ...makeSampleSelection({ proposed: [p1, p2], alternates: [] }),
      reviewed: [
        { transactionId: p2.transactionId, lokalId: p2.lokalId, at: "2026-08-20T09:00:00Z" },
      ],
    };

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() =>
      expect(screen.getByText("Propozycja 1 z 2 · przejrzane 1")).toBeInTheDocument(),
    );
  });

  it("'Anuluj' inside the rejection-reasons block closes it without rejecting the row", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const sel = makeSampleSelection({ proposed: [p1], alternates: [] });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Odrzuć" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("button", { name: /Potwierdź odrzucenie/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Odrzuć" })).toBeInTheDocument();
  });

  it("re-selecting the SAME row after unchecking it does NOT reopen the rejection-reasons block (advisor finding, 2026-08-22)", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const sel = makeSampleSelection({ proposed: [p1, p2], alternates: [] });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    const checkboxes = within(proposedTable).getAllByRole("checkbox");

    // Uncheck row A (p1) — panel pre-opens the reasons block for it.
    await user.click(checkboxes[0]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument(),
    );

    // Select row B (p2) — the block closes (no reason to reject B).
    await user.click(screen.getAllByTestId("proposed-row")[1]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Potwierdź odrzucenie/i })).toBeNull(),
    );

    // Back to row A, via an ordinary row click (not the checkbox) — must
    // NOT reopen the reasons block; the appraiser never unchecked it again.
    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Odrzuć" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Potwierdź odrzucenie/i })).toBeNull();
  });

  it("uncheck A's OWN row after the panel is already open on it (opened via a plain click, not the checkbox) — reasons block opens (Opus review round 1, I1)", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const sel = makeSampleSelection({ proposed: [p1, p2], alternates: [] });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    // Select row A (p1) via a plain row click — panel opens, NOT rejecting.
    await user.click(screen.getAllByTestId("proposed-row")[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Odrzuć" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Potwierdź odrzucenie/i })).toBeNull();

    // Now uncheck THAT SAME row's "w próbie" checkbox — `initialRejecting`
    // flips false→true for the candidate ALREADY selected (no candidate
    // change), which the mount/candidate-change reset alone would miss.
    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    await user.click(within(proposedTable).getAllByRole("checkbox")[0]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument(),
    );
  });

  it("uncheck A → Anuluj → uncheck A again — reasons block re-opens (Opus review round 1, I1)", async () => {
    const user = userEvent.setup();
    const p1 = makeCandidate({ transactionId: "T-P1", lokalId: "L-P1" });
    const p2 = makeCandidate({ transactionId: "T-P2", lokalId: "L-P2" });
    const sel = makeSampleSelection({ proposed: [p1, p2], alternates: [] });

    render(
      <StepSample
        valuationId={VID}
        address={ADDRESS}
        area={AREA}
        comparables={[p1, p2].map(rcnComparable)}
        sampleMeta={makeSampleMeta()}
        sampleSelection={sel}
        streetView={null}
      />,
    );

    const proposedTable = screen.getByRole("table", { name: "W próbie" });
    const checkbox = () => within(proposedTable).getAllByRole("checkbox")[0];

    await user.click(checkbox());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Potwierdź odrzucenie/i })).toBeNull(),
    );

    // Uncheck the SAME row again — must re-open, not stay dead.
    await user.click(checkbox());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Potwierdź odrzucenie/i })).toBeInTheDocument(),
    );
  });
});
