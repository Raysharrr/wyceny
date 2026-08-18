import { afterEach, describe, expect, it, vi } from "vitest";
import { proseStepProps } from "@/app/valuations/[id]/prose-step-props";
import { currentSectionFactsHash } from "@/domain/prose-hash";
import type { KcsInput } from "@/domain/kcs";
import type { ProseSnapshot } from "@/domain/prose-snapshot";
import type { Valuation } from "@/ports/valuation";

/**
 * The server half of step 6: what the RSC page hands the client component
 * (ADR-014, FR-6, T6). It answers three questions and no more — what is
 * persisted, does it still describe this draft, and which sections today's
 * facts could back.
 *
 * The kill-switch lives HERE, not only in the component: with the flag off,
 * step 6 must behave exactly as it did before FR-6 — which includes not
 * building facts and not running the KCS engine on the server.
 *
 * F-9: every address, note and number below is invented (ul. Klonowa,
 * m. Nowogród).
 */
afterEach(() => vi.unstubAllEnvs());

const ADDRESS = "ul. Klonowa 14/3, Nowogród";
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

const draft = (inputs: KcsInput | null): Valuation =>
  ({ id: "vid", address: ADDRESS, area: 68.4, status: "in_progress", inputs }) as Valuation;

describe("proseStepProps", () => {
  it("a fingerprint matching the current facts reads as up to date", () => {
    const current = currentSectionFactsHash("opis_lokalu", { address: ADDRESS, inputs: INPUTS });

    const props = proseStepProps(draft({ ...INPUTS, prose: prose(current) }));

    expect(props.upToDate).toBe(true);
    expect(props.generatableSections).toContain("opis_lokalu");
  });

  it("a fingerprint from an older draft reads as stale — the step will regenerate", () => {
    const props = proseStepProps(draft({ ...INPUTS, prose: prose("f".repeat(64)) }));

    expect(props.upToDate).toBe(false);
  });

  it("no proposals at all is not 'up to date'", () => {
    expect(proseStepProps(draft(INPUTS)).upToDate).toBe(false);
  });

  it("offers only the sections today's facts can back", () => {
    // No inspection note and no EGiB snapshot: the three note-fed sections and
    // the parcel one drop out, exactly as `selectProseSections` decides.
    const noNote = { ...INPUTS, inspection: undefined };

    expect(proseStepProps(draft(noNote)).generatableSections).toEqual([
      "analiza_rynku",
      "standard",
      "uzasadnienie",
    ]);
  });

  it("a draft with no inputs asks for nothing and claims nothing", () => {
    expect(proseStepProps(draft(null))).toEqual({
      prose: null,
      upToDate: true,
      generatableSections: [],
    });
  });

  it("NEXT_PUBLIC_PROSE=off: no facts are built and nothing is generatable", () => {
    // The client bundle drops the editors at build time, but the SERVER would
    // still run buildProseFacts -> computeKcs -> sha256 on every render. The
    // flag has to mean "step 6 behaves as it did before FR-6" on both halves,
    // or it cannot be used to roll the feature back.
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    const snapshot = prose("f".repeat(64));

    const props = proseStepProps(draft({ ...INPUTS, prose: snapshot }));

    expect(props).toEqual({ prose: snapshot, upToDate: true, generatableSections: [] });
  });
});
