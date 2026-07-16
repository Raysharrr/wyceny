import { describe, expect, it } from "vitest";
import {
  ApprovalBlockedError,
  approveValuation,
  confirmSampleProvenance,
} from "../src/domain/valuation";
import type { Valuation } from "../src/ports/valuation";
import type { KcsInput } from "../src/domain/kcs";
import type { InputsProvenance } from "../src/domain/provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function draftWith(inputs: KcsInput | null): Valuation {
  return {
    id: "v-1",
    address: "ul. Testowa 1, Poznań",
    area: 50,
    wr: 500_000,
    inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: null,
    kwNumber: null,
    client: null,
    inspectionDate: null,
    ownerId: "owner-1",
    status: "in_progress",
    approvedAt: null,
    createdAt: new Date("2026-07-14T10:00:00Z"),
  };
}

function rcnInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
      status: "to_verify" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    sampleMeta: {
      lat: 52.4,
      lon: 16.9,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
    },
    provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
  };
}

describe("confirmSampleProvenance", () => {
  it("flips rcn rows and geocode to confirmed, leaves scalars untouched", () => {
    const v = confirmSampleProvenance(draftWith(rcnInputs()));
    expect(v.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(v.inputs!.provenance!.geocode).toEqual({ source: "geokoder", status: "confirmed" });
    expect(v.inputs!.provenance!.address.status).toBe("confirmed");
    expect(v.status).toBe("in_progress");
  });

  it("does not touch manual rows (already confirmed) and is idempotent", () => {
    const first = confirmSampleProvenance(draftWith(rcnInputs()));
    const second = confirmSampleProvenance(first);
    expect(second.inputs).toEqual(first.inputs);
  });

  it("throws when the valuation is not a draft", () => {
    const approved = { ...draftWith(rcnInputs()), status: "approved" as const };
    expect(() => confirmSampleProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot", () => {
    expect(() => confirmSampleProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

describe("approveValuation", () => {
  const now = new Date("2026-07-14T12:00:00Z");

  it("blocks (ApprovalBlockedError with blockers) while anything is to_verify", () => {
    try {
      approveValuation(draftWith(rcnInputs()), now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.length).toBeGreaterThan(0);
    }
  });

  it("approves after confirmation: status approved + approvedAt set", () => {
    const confirmed = confirmSampleProvenance(draftWith(rcnInputs()));
    const approved = approveValuation(confirmed, now);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
  });

  it("blocks a snapshot-less draft", () => {
    expect(() => approveValuation(draftWith(null), now)).toThrow(ApprovalBlockedError);
  });

  it("throws for non-draft status (write-once after approval)", () => {
    const approved = {
      ...confirmSampleProvenance(draftWith(rcnInputs())),
      status: "approved" as const,
    };
    expect(() => approveValuation(approved, now)).toThrow(/draft/i);
  });
});
