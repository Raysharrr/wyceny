import { afterEach, describe, expect, it, vi } from "vitest";
import { proseStepProps } from "@/app/valuations/[id]/prose-step-props";
import { currentSectionFactsHash } from "@/domain/prose-hash";
import { PROSE_SECTIONS, type ProseSection, type ProseSnapshot } from "@/domain/prose-snapshot";
import type { KcsInput } from "@/domain/kcs";
import type { SessionUser, Valuation } from "@/ports/valuation";

/**
 * The server half of step 6: what the RSC page hands the client component
 * (ADR-014, FR-6, T6). It answers four questions and no more — what is
 * persisted, does it still describe this draft (and WHICH sections do not),
 * which sections today's facts could back, and what the generations so far
 * have cost.
 *
 * The kill-switch lives HERE, not only in the component: with the flag off,
 * step 6 must behave exactly as it did before FR-6 — which includes not
 * building facts, not running the KCS engine, and not querying the audit
 * trail on the server.
 *
 * F-9: every address, note and number below is invented (ul. Klonowa,
 * m. Nowogród).
 */
afterEach(() => vi.unstubAllEnvs());

const ADDRESS = "ul. Klonowa 14/3, Nowogród";
const USER: SessionUser = { id: "user-test-1", role: "appraiser" };
const INPUTS: KcsInput = {
  area: 68.4,
  comparables: [
    { date: "2024-11", area: 58.1, pricePerM2: 9240, source: "rcn", transactionId: "tx-1" },
    { date: "2025-03", area: 79.9, pricePerM2: 12480, source: "rcn", transactionId: "tx-2" },
    { date: "2024-12", area: 64, pricePerM2: 10725, source: "manual" },
  ],
  features: [
    { key: "standard_wykonczenia", name: "standard wykończenia", weight: 1, rating: "lepsza" },
  ],
  inspection: {
    note: "Układ: 2 pokoje, kuchnia, łazienka; otoczenie: zabudowa wielorodzinna.",
    photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
  },
};

// T2 moved the fingerprint from one per valuation to one per SECTION — this
// fixture carries a single section (opis_lokalu) so a mismatch on that one
// section is enough to make the whole draft read as not up to date, which is
// exactly what the pre-T2 whole-valuation fingerprint used to mean.
const prose = (opisLokaluHash: string): ProseSnapshot => ({
  sections: {
    opis_lokalu: {
      value: "Lokal obejmuje dwa pokoje z kuchnią.",
      provenance: { source: "ai", status: "to_verify" },
    },
  },
  rejected: {},
  factsHashes: { opis_lokalu: opisLokaluHash },
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
});

/** A snapshot in which exactly `sections` are present, fingerprinted against TODAY's facts. */
const freshProse = (sections: ProseSection[], inputs: KcsInput = INPUTS): ProseSnapshot => ({
  sections: Object.fromEntries(
    sections.map((s) => [
      s,
      { value: `Tekst sekcji ${s}.`, provenance: { source: "ai", status: "to_verify" } },
    ]),
  ) as ProseSnapshot["sections"],
  rejected: {},
  factsHashes: Object.fromEntries(
    sections.map((s) => [s, currentSectionFactsHash(s, { address: ADDRESS, inputs })]),
  ),
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
});

const draft = (inputs: KcsInput | null): Valuation =>
  ({ id: "vid", address: ADDRESS, area: 68.4, status: "in_progress", inputs }) as Valuation;

const NO_USAGE = { generations: 0, inputTokens: 0, outputTokens: 0 };

const repo = (usage = NO_USAGE) => ({ proseUsage: vi.fn().mockResolvedValue(usage) });

/** The sections `selectProseSections` backs for a given draft, asked of the code itself. */
async function generatableOf(inputs: KcsInput): Promise<ProseSection[]> {
  return (await proseStepProps(draft(inputs), USER, repo())).generatableSections;
}

describe("proseStepProps", () => {
  it("a fingerprint matching the current facts reads as fresh for THAT section", async () => {
    const current = currentSectionFactsHash("opis_lokalu", { address: ADDRESS, inputs: INPUTS });

    const props = await proseStepProps(draft({ ...INPUTS, prose: prose(current) }), USER, repo());

    expect(props.staleSections).toEqual([]);
    expect(props.generatableSections).toContain("opis_lokalu");
  });

  it("a fingerprint from an older draft names that section as stale", async () => {
    const props = await proseStepProps(
      draft({ ...INPUTS, prose: prose("f".repeat(64)) }),
      USER,
      repo(),
    );

    expect(props.staleSections).toEqual(["opis_lokalu"]);
    expect(props.upToDate).toBe(false);
  });

  it("no proposals at all is not 'up to date'", async () => {
    expect((await proseStepProps(draft(INPUTS), USER, repo())).upToDate).toBe(false);
  });

  it("every generatable section present and fresh IS up to date", async () => {
    const props = await proseStepProps(
      draft({ ...INPUTS, prose: freshProse(await generatableOf(INPUTS)) }),
      USER,
      repo(),
    );

    expect(props.upToDate).toBe(true);
    expect(props.staleSections).toEqual([]);
  });

  it("...but one MISSING generatable section is not 'up to date' either", async () => {
    // Missing and stale are different states, and only one of them belongs in
    // `staleSections` — yet both must keep `upToDate` false. A no-opts
    // `proposeProse` would happily generate the missing section, and the F-4
    // gate blocks approval on every one of the six that has no text, so a
    // screen reading "up to date" here would disagree with both.
    const allButOne = (await generatableOf(INPUTS)).filter((s) => s !== "analiza_rynku");

    const props = await proseStepProps(
      draft({ ...INPUTS, prose: freshProse(allButOne) }),
      USER,
      repo(),
    );

    expect(props.staleSections).toEqual([]);
    expect(props.upToDate).toBe(false);
  });

  it("a missing section the facts CANNOT back does not make the draft stale", async () => {
    // Nothing would regenerate it — the appraiser writes it by hand. Claiming
    // "not up to date" would fire a generation that skips it anyway.
    const noNote = { ...INPUTS, inspection: undefined };
    const generatable = await generatableOf(noNote);

    const props = await proseStepProps(
      draft({ ...noNote, prose: freshProse(generatable, noNote) }),
      USER,
      repo(),
    );

    expect(generatable).not.toContain("opis_lokalu");
    expect(props.upToDate).toBe(true);
  });

  it("offers only the sections today's facts can back", async () => {
    // No inspection note and no EGiB snapshot: the three note-fed sections and
    // the parcel one drop out, exactly as `selectProseSections` decides.
    const noNote = { ...INPUTS, inspection: undefined };

    expect(await generatableOf(noNote)).toEqual(["analiza_rynku", "standard", "uzasadnienie"]);
  });

  it("names every stale section, not just the first, in the operat's own order", async () => {
    const snapshot = freshProse(await generatableOf(INPUTS));
    snapshot.factsHashes.uzasadnienie = "e".repeat(64);
    snapshot.factsHashes.analiza_rynku = "f".repeat(64);

    const props = await proseStepProps(draft({ ...INPUTS, prose: snapshot }), USER, repo());

    expect(props.staleSections).toEqual(
      PROSE_SECTIONS.filter((s) => s === "analiza_rynku" || s === "uzasadnienie"),
    );
  });

  it("names the sections already attempted at today's facts", async () => {
    // The bound on re-buying a refusal — recorded whatever came back, and
    // compared against TODAY's fingerprint, so it stops counting the moment
    // the facts move under it.
    const snapshot = freshProse(await generatableOf(INPUTS));
    snapshot.attempts = {
      otoczenie: currentSectionFactsHash("otoczenie", { address: ADDRESS, inputs: INPUTS }),
      standard: "f".repeat(64),
    };

    const props = await proseStepProps(draft({ ...INPUTS, prose: snapshot }), USER, repo());

    expect(props.attemptedSections).toEqual(["otoczenie"]);
  });

  it("converts the audit trail's tokens into groszy and passes the counts through", async () => {
    const r = repo({ generations: 2, inputTokens: 3120, outputTokens: 480 });

    const props = await proseStepProps(draft(INPUTS), USER, r);

    expect(r.proseUsage).toHaveBeenCalledWith("vid", USER);
    expect(props.usage).toEqual({ generations: 2, tokens: 3600, grosze: 7 });
  });

  it("a draft with no inputs asks for nothing, claims nothing and costs no query", async () => {
    const r = repo();

    expect(await proseStepProps(draft(null), USER, r)).toEqual({
      prose: null,
      upToDate: true,
      staleSections: [],
      attemptedSections: [],
      generatableSections: [],
      usage: { generations: 0, tokens: 0, grosze: 0 },
    });
    expect(r.proseUsage).not.toHaveBeenCalled();
  });

  it("NEXT_PUBLIC_PROSE=off: no facts are built, nothing is generatable, no query is made", async () => {
    // The client bundle drops the editors at build time, but the SERVER would
    // still run buildProseFacts -> computeKcs -> sha256 on every render, and
    // now an audit aggregate on top. The flag has to mean "step 6 behaves as
    // it did before FR-6" on both halves, or it cannot roll the feature back.
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    const snapshot = prose("f".repeat(64));
    const r = repo({ generations: 9, inputTokens: 1, outputTokens: 1 });

    const props = await proseStepProps(draft({ ...INPUTS, prose: snapshot }), USER, r);

    expect(props).toEqual({
      prose: snapshot,
      upToDate: true,
      staleSections: [],
      attemptedSections: [],
      generatableSections: [],
      usage: { generations: 0, tokens: 0, grosze: 0 },
    });
    expect(r.proseUsage).not.toHaveBeenCalled();
  });
});
